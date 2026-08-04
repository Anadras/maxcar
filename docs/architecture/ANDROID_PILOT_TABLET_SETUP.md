# MAXCAR — Preparar um tablet físico para o piloto (MAX-007)

Passo a passo operacional para colocar um Black Shark (ou aparelho
equivalente) rodando o player MAXCAR em um veículo. Cobre instalação,
configuração do aparelho e os testes mínimos antes de liberar para a rua.
Para a arquitetura por trás de cada passo, veja
[ANDROID_PLAYER.md](ANDROID_PLAYER.md),
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md) e
[ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md).

## 1. Cadastrar uma vinheta real

No painel (`super_admin`/`admin`/`commercial`):

1. Cadastre (ou reaproveite) um anunciante e uma campanha `REGULAR`.
2. Em `/campanhas/[id]`, envie um criativo — MP4/H.264 recomendado (ver
   [ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md#recomendação-de-criativo-para-o-piloto)).
3. Preencha o período (`starts_at`/`ends_at`) e ative a campanha — o painel
   bloqueia a ativação se algo estiver faltando (`ReadinessBanner`).
4. No mesmo card "Grade regular do piloto", clique **Incluir na grade do
   piloto**. Isso vincula a campanha à grade padrão global (sem `device_id`
   próprio) — qualquer tablet ativado sem uma grade específica passa a
   recebê-la no próximo sync.

## 2. Ativar o tablet no painel

Em `/dispositivos/[id]`, gere um código de ativação (card "Ativação do
tablet", 15 minutos, uso único) — ver
[ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md).

## 3. Instalar o APK

```bash
cd apps/android
./gradlew :app:assembleStagingDebug
adb devices                     # confirme que o tablet aparece
adb install -r app/build/outputs/apk/staging/debug/app-staging-debug.apk
```

`-r` preserva os dados do app (enrollment, grade já baixada) numa
reinstalação. Se uma mudança de schema do Room exigir um banco limpo (não
há migração automática configurada ainda — ver
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md)), desinstale primeiro:

```bash
adb uninstall com.maxcar.tablet.staging.debug
adb install app/build/outputs/apk/staging/debug/app-staging-debug.apk
```

Nesse caso o tablet perde o enrollment e precisa de um novo código.

## 4. Abrir e sincronizar

```bash
adb shell monkey -p com.maxcar.tablet.staging.debug 1
```

Digite o código de ativação na tela. Após ativar, o app busca a config
remota, sincroniza a grade automaticamente
(`InitialSyncWorker` → `MediaSyncWorker`) e entra no player assim que o
primeiro item estiver `READY`. Para forçar sem esperar: toque cinco vezes
no canto inferior direito da tela (gesto oculto, sem indicação visual) para
abrir o diagnóstico, e use **Sincronizar agora**.

## 5. Testar offline

Sequência mínima antes de liberar um tablet para a rua (item 31/63 do
marco):

1. Confirme no diagnóstico que "Mídias prontas" > 0.
2. Confirme que a vinheta está tocando em tela cheia, em loop.
3. Desligue Wi-Fi e dados móveis do tablet.
4. Mantenha a reprodução por vários ciclos completos da grade — deve
   continuar normalmente, sem travar ou mostrar erro.
5. Feche o app (ou reinicie o tablet) ainda sem internet.
6. Abra de novo — o player deve voltar a tocar usando a grade já baixada,
   sem esperar conexão.
7. Religue a internet — heartbeat e eventos de reprodução pendentes
   sincronizam no próximo ciclo, sem intervenção.

## 6. Sair do modo player (uso técnico)

Cinco toques no canto inferior direito → diagnóstico → **Voltar ao
player** para retornar. Durante o piloto, sem Device Owner configurado, um
técnico também pode forçar a saída via ADB:

```bash
adb shell am force-stop com.maxcar.tablet.staging.debug
```

## Device Owner — avaliado, não ativado

Lock Task real (bloqueio total de saída, sem depender do gesto oculto)
exige o app provisionado como **Device Owner** via
`dpm set-device-owner`, o que só é possível em um aparelho recém-resetado
de fábrica (ou sem conta Google configurada). Isso não foi executado neste
marco — exigiria um factory reset do tablet físico, uma ação destrutiva e
irreversível sem autorização explícita.

Se decidido para um marco futuro:

- **Comando**: `adb shell dpm set-device-owner com.maxcar.tablet.staging.debug/.AdminReceiver`
  (exige um `DeviceAdminReceiver` que este marco não implementa) executado
  logo após o factory reset, antes de qualquer conta ser adicionada.
- **Impacto do reset**: apaga todos os dados do aparelho — enrollment,
  grade baixada, configurações locais. Precisa ser feito antes do tablet
  ser instalado no veículo, não depois.
- **O que isso desbloqueia**: `startLockTask()` passa a bloquear
  efetivamente Home/Recents/notificações; `DevicePolicyManager` permite
  desabilitar configurações do sistema, instalar/atualizar o app
  silenciosamente e impedir a instalação de outros apps — a base de um MDM
  corporativo real.
- Sem isso, o que já está implementado (imersivo, back bloqueado, gesto
  oculto) é a "primeira camada" seguramente testável descrita em
  [ANDROID_PLAYER.md](ANDROID_PLAYER.md#tela-cheia-e-tela-ligada) — real,
  mas não à prova de um usuário técnico.

## Auto-start e otimização de bateria

Fabricantes com skins agressivas de gerenciamento de energia (o Black Shark
deste piloto incluso, baseado em JoyUI/MIUI) costumam bloquear
`BOOT_COMPLETED` e matar apps em segundo plano por padrão, mesmo com a
permissão declarada no manifest. Ajuste manual recomendado por tablet:

1. **Ajustes → Bateria → Uso de bateria do app → MAXCAR Tablet** → definir
   como "Sem restrições" (não otimizar).
2. **Ajustes → Apps → Gerenciamento de inicialização** (ou equivalente,
   "Autostart"/"Início automático") → habilitar para o MAXCAR Tablet.
3. Alguns aparelhos têm uma opção separada de "bloquear" o app na tela de
   apps recentes (ícone de cadeado ao segurar o card do app) — habilite
   para evitar que o sistema o finalize.

Sem esses ajustes, o app abre normalmente quando tocado manualmente, mas
pode não voltar sozinho após reboot ou after ficar muito tempo em segundo
plano — um ponto de atenção operacional para a instalação em campo, não um
bug do app.

## Brilho da tela

Não é ajustado automaticamente pelo app. Recomendação para o piloto: fixar
o brilho manualmente em um nível alto e confortável (Ajustes → Tela →
Brilho, desativar brilho automático) antes de instalar o tablet no
veículo — evita variação por sensor de luminosidade em um habitáculo
fechado.

## Recuperação em caso de erro

| Sintoma                                         | Causa provável                                                 | Ação                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tela "Conteúdo sendo preparado" indefinidamente | Sem campanha elegível na grade, ou download ainda em andamento | Confira o card "Grade regular do piloto" no painel; toque "Sincronizar agora" no diagnóstico                |
| Volta para a tela de ativação sozinho           | Credencial revogada no painel (ou nunca ativado)               | Gere um novo código e reative                                                                               |
| App não abre após reboot                        | Bloqueio de auto-start do fabricante                           | Ver seção acima; `adb shell am start -n com.maxcar.tablet.staging.debug/.MainActivity` como contorno manual |
| Um item específico nunca fica pronto            | Hash ou download falhando repetidamente                        | Diagnóstico mostra o estado por item; revisar o criativo no painel (reenviar se corrompido)                 |

## Checklist final antes de liberar para a rua

- [ ] Vinheta real cadastrada, ativa, incluída na grade do piloto.
- [ ] Tablet ativado no painel (status "Ativado" no card de ativação).
- [ ] "Mídias prontas" > 0 no diagnóstico.
- [ ] Reprodução contínua confirmada em tela cheia.
- [ ] Teste offline (seção 5) concluído sem erro.
- [ ] Otimização de bateria e auto-start ajustados (seção acima).
- [ ] Brilho fixado manualmente.
