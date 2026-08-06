# MAXCAR — Watchdog do player (MAX-012)

Como o app deixa de confiar no ExoPlayer para avisar quando algo travou, e
passa a detectar isso sozinho. Motivado por um incidente físico real no
TESTE01: veja a causa raiz abaixo antes das mecânicas.

## O incidente que motivou isto

Durante um piloto ao vivo, a campanha "regular02" fazia o decodificador de
hardware do tablet (Black Shark/MediaTek, `c2.mtk.avc.decoder`) travar por
**10 a 15 minutos** antes de finalmente emitir `PlaybackException`. Durante
todo esse tempo:

- o processo do app continuava vivo;
- o heartbeat automático continuava chegando ao Cloud;
- `current_campaign_id`/`player_state` continuavam apontando para o item
  travado, reportando "playing";
- nenhum frame novo era desenhado — a tela ficava preta.

Comparação completa (Cloud vs. manifesto vs. Room vs. arquivo local vs.
`playback_events`) provou que o arquivo em si era válido: hash, tamanho,
container e codec (`avc1`/`mp4a`, H.264/AAC padrão) todos corretos. A causa
não era o arquivo — era a total ausência de um limite de tempo próprio do
app para decidir "isso não vai se recuperar sozinho, avance".

## O que existe agora

Três temporizadores independentes, todos vivendo em
[`PlayerViewModel`](../../apps/android/app/src/main/kotlin/com/maxcar/tablet/ui/player/PlayerViewModel.kt),
armados a cada `playItem()` e cancelados assim que o item termina por
qualquer via (sucesso, erro real, ou um dos próprios watchdogs):

1. **First frame timeout** (`FIRST_FRAME_TIMEOUT_MS = 5000`): se nenhum
   `onRenderedFirstFrame` chegar em 5s após `prepare()`, o item é tratado
   como travado — exatamente o sintoma do regular02.
2. **Playback stall** (`STALL_CHECK_INTERVAL_MS = 2000`,
   `STALL_TIMEOUT_MS = 5000`): depois do primeiro frame, um ticker compara
   `exoPlayer.currentPosition` a cada 2s; se a posição não muda por 5s
   enquanto `isPlaying && STATE_READY`, tenta uma única recuperação curta
   (`exoPlayer.play()`) e, se não resolver no próximo ciclo, desiste do
   item.
3. **Duration watchdog** (`DURATION_GRACE_MS = 5000`): teto absoluto por
   item — duração declarada no manifesto + 5s de folga. Nunca espera o
   decoder admitir erro; força o avanço mesmo que os dois watchdogs acima
   nunca disparem.

Qualquer um dos três aciona exatamente o mesmo caminho que um
`PlaybackException` real já usava:
`finishCurrentItem(completed = false, reason)` → grava `playback_events`
com status `failed` → contabiliza para quarentena → `advance()` para o
próximo item `READY` (nunca fica esperando).

Um `playToken` incrementado a cada `playItem()` garante que um watchdog
agendado para um item já superado (por sucesso, erro real, ou outro
watchdog) simplesmente não faz nada ao disparar — nunca finaliza o item
errado numa corrida.

## Quarentena (circuit breaker)

Duas falhas consecutivas do mesmo `creativeId` + `sha256`
(`MediaQuarantineEntity`, tabela Room `media_quarantine`, migração
`AppDatabase.MIGRATION_8_9`) colocam aquela mídia em quarentena por 30
minutos (`QUARANTINE_DURATION_MILLIS`). Enquanto ativa:

- o item some de `MediaDownloadManager.readyPlaylist` (a mesma fila que o
  player e o GEO já liam) — o resto da grade continua normalmente;
- uma nova sincronização com hash diferente (`sha256` mudou) limpa a
  quarentena imediatamente (`clearIfHashChanged`, chamado a cada
  `MediaDownloadManager.sync()`) — uma campanha com mídia nova nunca fica
  presa por uma falha antiga;
- a quarentena também expira sozinha depois de 30 min, sem ação manual.

A identidade da quarentena é a **mídia**, nunca a campanha — o mesmo
`creativeId` reaparecendo com hash igual continua bloqueado; qualquer coisa
com hash diferente é tratada como arquivo novo.

## Telemetria

`player_state` no heartbeat ganhou um vocabulário mais rico
(`PlaybackState`, `data/local/PlaybackState.kt`, compartilhado entre
`PlayerViewModel` e `SyncCoordinator` para não criar dependência de
`sync` sobre `ui.player`):

`preparing` → `buffering` → `playing_confirmed` → (`stalled` →
`recovering`)? → (`media_error`)? / `no_ready_media`.

`playing_confirmed` só é reportado quando **todos** são verdade: primeiro
frame renderizado, ExoPlayer em `STATE_READY`/`isPlaying`, e (via o
próprio watchdog) posição avançando recentemente — nunca mais um
"playing" que só significa "o item foi selecionado".

`SyncCoordinator.operationalStatusFor` mapeia isso para o
`operationalStatus` do heartbeat (`recovering`/`media_error` são valores
novos ali — ver migração `20260819090000_player_watchdog_telemetry.sql`,
que também adicionou a coluna `quarantined_media_count`), e o painel
(`apps/admin/app/(protected)/dispositivos/[id]/page.tsx`) usa isso em
`playbackDiagnosis()` para nunca mais mostrar "reproduzindo" sem saber que
há um frame real na tela.

## O que este marco deliberadamente não cobre

- Um watchdog de imagem equivalente não existe porque não é necessário: a
  exibição de uma imagem local (`BitmapFactory.decodeFile`) não passa pelo
  decodificador de hardware que travou no incidente original, e já tem seu
  próprio `imageJob` com `delay()` como teto de duração.
- Os três temporizadores em si (first-frame/stall/duration) não têm
  cobertura automatizada via Robolectric: o ExoPlayer simulado do
  Robolectric não reproduz um decodificador de hardware realmente
  travando, então não há como provar em CI que os temporizadores disparam
  contra uma trava real. `PlayerViewModelWatchdogTest` cobre a mecânica de
  falha/quarentena/avanço (via um arquivo local ausente — o mesmo caminho
  síncrono de falha, sem precisar decodificar nada); a prova de que os
  temporizadores disparam contra uma trava real de decoder é o teste
  físico com uma mídia de fixture controlada (ver o plano de teste físico
  do marco MAX-012).
