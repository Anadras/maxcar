# MAXCAR — Kiosk (MAX-010)

Como o tablet vira um aparelho dedicado: o passageiro só vê anúncios, e
existe um jeito seguro e auditável de sair disso. Para o PIN e o modo
técnico em si, veja
[ANDROID_MAINTENANCE_MODE.md](ANDROID_MAINTENANCE_MODE.md). Para a
instalação física do Black Shark, veja
[ANDROID_PILOT_TABLET_SETUP.md](ANDROID_PILOT_TABLET_SETUP.md).

## Regra central: nunca fixar tela sem conteúdo pronto

Antes deste marco, `MainActivity.applyKioskMode` chamava `startLockTask()`
sempre que o player era a tela ativa — inclusive com a grade vazia,
prendendo potencialmente o operador atrás de uma tela "Conteúdo sendo
preparado" fixada. Agora:

```
playerActive      = isEnrolled && !mostrando diagnóstico
lockTaskEligible  = playerActive && grade tem item READY && kiosk_enabled (config remota)
```

`lockTaskEligible` é recalculado a cada mudança de estado do player
(`MaxcarApp`, `MainActivity.kt`). Tela cheia imersiva
(`WindowInsetsControllerCompat`) continua ativa sempre que `playerActive`
— inclusive na tela "preparando conteúdo" — mas `startLockTask()`/
`stopLockTask()` só são chamados quando `lockTaskEligible` muda. Uma grade
que fica vazia enquanto fixada (todos os itens expiraram, por exemplo) sai
da fixação automaticamente no próximo recomposition, nunca prende o
tablet.

`kiosk_enabled` (`app_remote_config`, existia desde o MAX-006 mas não era
usado) agora é o interruptor geral: com `false`, o tablet nunca tenta
fixar tela, mesmo com conteúdo pronto — só o imersivo.

## Três camadas, o que cada uma realmente é

| Camada                  | O que garante                                                            | Como é ativada                                                                    | Pode ser burlada por                                                                                            |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Imersivo**            | Barras de sistema escondidas, sem controles visíveis                     | Sempre que `playerActive`                                                         | Um usuário técnico que force-stop o app via ADB                                                                 |
| **Lock Task (fixação)** | Home/Recents bloqueados, enquanto o Android permitir                     | `startLockTask()`, condicionado a `lockTaskEligible`                              | Sem Device Owner, o próprio Android pode ignorar ou pedir confirmação do usuário — nunca presumir que funcionou |
| **Device Owner**        | Bloqueio profissional real (Home/Recents/notificações inegociáveis, MDM) | `dpm set-device-owner` — ver seção abaixo, **ativado no TESTE01 em 2026-08-05, sem factory reset** | Só por outro Device Owner ou reset de fábrica                                                                   |

## O painel nunca finge proteção que não existe

`KioskLevelDetector` (`kiosk/KioskLevelDetector.kt`) não confia em "eu
chamei `startLockTask()`" como prova de que funcionou — consulta o estado
real do Android a cada heartbeat:

- `DevicePolicyManager.isDeviceOwnerApp(packageName)` → `device_owner`.
- `ActivityManager.lockTaskModeState != LOCK_TASK_MODE_NONE` → `lock_task`.
- Caso contrário, `immersive` se a tela cheia estiver ativa, senão `none`.

Reportado em `device_heartbeats.kiosk_level`, exibido no card "Kiosk e
manutenção" do detalhe do dispositivo — a mesma filosofia de "nunca dado
inventado" do resto do monitoramento (ver
[DEVICE_MONITORING.md](DEVICE_MONITORING.md)).

## Device Owner (MAX-011)

O app agora declara um `DeviceAdminReceiver` (`kiosk/AdminReceiver.kt`,
`res/xml/device_admin_receiver.xml`, `<receiver>` no manifest) e
`MainActivity.configureDeviceOwnerLockTaskPoliciesIfApplicable()` chama,
uma vez a cada cold start:

```kotlin
devicePolicyManager.setLockTaskPackages(admin, arrayOf(packageName))
devicePolicyManager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
```

`LOCK_TASK_FEATURE_NONE` é o que bloqueia Home/Recents/notificações/
global actions de forma real, não apenas o pinning "melhor esforço" que já
existia. Ambas as chamadas são no-op silencioso (`isDeviceOwnerApp ==
false`, guarded por `runCatching`) numa tablet ainda não provisionada.

**Provisionamento em si nunca é automático** — é uma ação irreversível
(só desfeita por outro Device Owner ou factory reset) e continua exigindo
autorização explícita antes de rodar:

```bash
adb shell dpm set-device-owner \
  com.maxcar.tablet.staging.debug/com.maxcar.tablet.kiosk.AdminReceiver
```

Note o componente **totalmente qualificado**
(`com.maxcar.tablet.kiosk.AdminReceiver`, não
`com.maxcar.tablet.staging.debug.kiosk.AdminReceiver`) — o `applicationId`
de staging (`com.maxcar.tablet.staging.debug`, via `applicationIdSuffix`)
diverge do namespace real do manifest (`com.maxcar.tablet`), e `dpm`
resolve nomes relativos (`.kiosk.AdminReceiver`) contra o primeiro
argumento, não contra o namespace do manifest — usar a forma curta falha
com `Not active admin`, mesmo com o app instalado e o receiver
corretamente declarado.

**Pré-requisitos** (verificados via `adb shell dpm list-owners` +
`adb shell dumpsys account` antes de tentar): nenhum Device Owner/Profile
Owner já ativo, **zero contas configuradas no aparelho**, um único
usuário. Quando essas três condições valem, `dpm set-device-owner`
funciona via ADB **sem exigir factory reset** — o factory reset só é
necessário para *remover* contas/usuários pré-existentes que violem essas
condições, não é um requisito incondicional do comando em si.

Validado fisicamente no TESTE01 em 2026-08-05: `dpm list-owners`
confirmou `DeviceOwner,Affiliated`; heartbeat reportou
`kiosk_level = 'device_owner'`; Home, Recentes, barra de notificações e
Voltar testados via `adb shell input keyevent`/`cmd statusbar
expand-notifications` — nenhum saiu do player, que continuou avançando
pela grade normalmente durante todo o teste.

## Saída temporária com retorno automático (MAX-011)

Um único mecanismo cobre as duas formas de suspender o quiosque
temporariamente — nunca abre a tela de diagnóstico remotamente, só a
libera do pinning:

- **PIN físico** (5 toques + PIN correto → diagnóstico).
- **Comando remoto** `disable_kiosk_temporarily` (painel → `device_commands`
  → `DeviceCommandExecutor`), sem abrir diagnóstico — só libera o Lock
  Task, mantendo a política de "comando remoto nunca contorna o gesto
  físico" já documentada em
  [ANDROID_MAINTENANCE_MODE.md](ANDROID_MAINTENANCE_MODE.md).

Ambos apenas gravam um prazo absoluto em
`AppPreferences.kioskSuspendedUntilMillis` (persistido em DataStore, não
em memória — sobrevive a reabrir a tela ou reiniciar o processo).
`MaxcarApp` roda um `LaunchedEffect` que tickeia a cada segundo enquanto
esse prazo existir; ao vencer, zera o prazo e (se a tela de diagnóstico
estiver aberta) volta ao player sozinho. `lockTaskEligible` passa a
exigir `!kioskSuspended` além das condições já existentes. Duração
configurável por dispositivo
(`devices.maintenance_timeout_seconds`, 60–1800s, painel → card "Kiosk e
manutenção") ou pelo padrão do app (`RemoteConfigEntity.
DEFAULT_MAINTENANCE_TIMEOUT_SECONDS = 300`) quando não configurada.
`enable_kiosk`/`reenter_kiosk` (idênticos) zeram o prazo imediatamente.

Validado fisicamente: PIN correto abriu o diagnóstico mostrando
"Modo quiosque temporariamente suspenso. Retorno automático em Ns..." com
a contagem regressiva decrescendo em tempo real (298s → 274s → 253s →
234s ao longo de ~64s reais).

## Auto-start e Foreground Service

Já cobertos por
[ANDROID_PLAYER.md](ANDROID_PLAYER.md#auto-start-após-reboot) (boot) e
[ANDROID_LOCATION.md](ANDROID_LOCATION.md#locationforegroundservice)
(GPS/player contínuo) — MAX-010 não muda esse comportamento, só a decisão
de fixar tela ou não em cima dele.
