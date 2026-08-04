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
| **Device Owner**        | Bloqueio profissional real (Home/Recents/notificações inegociáveis, MDM) | `dpm set-device-owner`, exige factory reset — **nunca executado automaticamente** | Só por outro Device Owner ou reset de fábrica                                                                   |

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

## Device Owner — avaliado, não ativado

Ver a seção dedicada em
[ANDROID_PILOT_TABLET_SETUP.md](ANDROID_PILOT_TABLET_SETUP.md#device-owner--avaliado-não-ativado)
— nada mudou neste marco: continua exigindo um factory reset manual e
autorizado, nunca executado por este código.

## Auto-start e Foreground Service

Já cobertos por
[ANDROID_PLAYER.md](ANDROID_PLAYER.md#auto-start-após-reboot) (boot) e
[ANDROID_LOCATION.md](ANDROID_LOCATION.md#locationforegroundservice)
(GPS/player contínuo) — MAX-010 não muda esse comportamento, só a decisão
de fixar tela ou não em cima dele.
