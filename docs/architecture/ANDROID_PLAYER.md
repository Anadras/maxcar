# MAXCAR — Player regular (MAX-007)

O primeiro player real do tablet: reproduz a grade REGULAR baixada
localmente, em tela cheia, continuamente, com ou sem internet. Cobre a
experiência de reprodução; para como o conteúdo chega ao tablet, veja
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md) e
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md). Para o registro de
reprodução, veja [ANDROID_PLAYBACK_EVENTS.md](ANDROID_PLAYBACK_EVENTS.md).

## Fora deste marco

GPS, GEO, mapas, streaming direto de URL, atualização remota do APK e MDM
corporativo completo — ver `AGENTS.md`. O player só toca o que já está
validado em disco; nunca reproduz direto de uma URL assinada.

## Arquitetura

`ui/player/PlayerViewModel.kt` é o único dono do `ExoPlayer` e da fila da
grade. Observa `MediaDownloadManager.readyPlaylist` (itens
`READY`, em ordem de posição) e decide o que está tocando agora — a UI
(`PlayerScreen.kt`) só renderiza o estado que o ViewModel expõe.

Vídeo e imagem compartilham uma única máquina de estados
(`PlayerUiState`: `Initializing`, `Empty`, `Playing`), em vez de dois
motores de reprodução independentes:

- **Vídeo** toca via Media3 ExoPlayer (`androidx.media3:media3-exoplayer`),
  renderizado com `PlayerView` (`media3-ui`) dentro de um `AndroidView` do
  Compose. `useController = false` — nenhum controle visível ao passageiro.
- **Imagem** é decodificada localmente (`BitmapFactory.decodeFile`, fora da
  main thread) e mostrada em `Image` do Compose; o avanço usa um timer de
  coroutine (`delay`), não o suporte nativo de imagem do Media3 — mantém um
  único motor de decisão de avanço, em vez de dois ouvindo eventos
  diferentes (`STATE_ENDED` do ExoPlayer vs. um timer).

Ambos usam `ContentScale.Fit` / `RESIZE_MODE_FIT`: preserva a proporção
original, nunca distorce, aceita letterbox quando a proporção do criativo
não bate com a da tela.

## Duração de imagem

Duração vem de `campaign_creatives.duration_seconds`, herdada pelo
manifesto (`ManifestPlaylistItem.durationSeconds`). Quando ausente ou
`<= 0`, usa-se **10 segundos** como padrão — constante única em
`PlayerViewModel.DEFAULT_IMAGE_DURATION_SECONDS`, nunca duplicada em outro
lugar.

## Orientação

O tablet piloto (Black Shark, 11") roda em **landscape**
(`android:screenOrientation="landscape"` no `MainActivity`, decisão do
MAX-006 preservada). Criativos verticais aparecem com letterbox lateral em
vez de esticar — aceito para o piloto; um criativo dedicado por orientação
fica para um marco futuro caso vinhetas verticais se tornem comuns.

## Grade regular

- Ordena pelos itens `READY` retornados por `PlaylistItemDao.observeReady()`
  (ordenados por `position`).
- Ao fim da fila, reinicia do início — loop contínuo.
- Um item que falha (arquivo ausente, erro de decodificação do ExoPlayer)
  avança para o próximo sem derrubar o app; `consecutiveFailures` impede um
  loop instantâneo de erro — depois de uma volta inteira só com falhas, o
  player entra no estado `Empty` (tela de fallback) em vez de girar a CPU
  reprocessando o mesmo erro sem parar.
- Uma atualização de manifesto durante a reprodução **nunca** interrompe o
  item atual: a nova grade fica pendente (`pendingQueue`) e só assume no
  próximo ciclo completo — ver `PlayerViewModel.onQueueUpdated`.

## Sem conteúdo

Grade vazia (nenhum item `READY`) mostra uma tela discreta — "MAXCAR /
Conteúdo sendo preparado." — nunca tela preta, crash ou mensagem técnica. O
motivo real (sem campanha, sync pendente, download em andamento, erro de
mídia, armazenamento insuficiente) fica só no diagnóstico
(`lastError`/`downloadStatus` por item, visíveis via ADB/Studio ou, de
forma agregada, no heartbeat/painel).

## Tela cheia e tela ligada

`MainActivity.applyKioskMode` (chamado sempre que o modo player está ativo):

- `WindowInsetsControllerCompat.hide(systemBars())` + comportamento
  `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` — imersivo, sem barras visíveis,
  reaparecem brevemente com um swipe da borda.
- `FLAG_KEEP_SCREEN_ON` — tela nunca apaga enquanto o player está ativo;
  removida ao entrar no diagnóstico (item 25: não manter a tela ligada fora
  do modo operacional).
- `BackHandler(enabled = playerActive) {}` — o botão/gesto voltar não faz
  nada durante a reprodução.
- `startLockTask()`/`stopLockTask()` chamados de forma defensiva
  (`runCatching`, log seguro em falha). Sem Device Owner configurado (não
  feito neste piloto — ver
  [ANDROID_PILOT_TABLET_SETUP.md](ANDROID_PILOT_TABLET_SETUP.md#device-owner-avaliado-não-ativado)),
  o Android ignora silenciosamente ou mostra a UX nativa de fixar tela;
  nunca um crash.

## Saída técnica para diagnóstico

Cinco toques num canto inferior direito (área invisível, 64dp,
`PlayerViewModel.onDiagnosticTap`) dentro de uma janela de 2 segundos abrem
a tela de diagnóstico (`DeviceHomeScreen`, já existente do MAX-006, agora
com contagem de mídias prontas e o botão "Sincronizar agora"). Nenhum botão
visível — o passageiro não tem como sair dos anúncios por acidente. Um
botão "Voltar ao player" no diagnóstico devolve o controle.

## Auto-start após reboot

`work/BootCompletedReceiver.kt` escuta `BOOT_COMPLETED`
(`RECEIVE_BOOT_COMPLETED` no manifest) e abre `MainActivity`, que decide
sozinha o que mostrar a partir do estado local — sem lógica de retomada
separada. Alguns fabricantes (o Black Shark deste piloto incluso) bloqueiam
isso por padrão; ver
[ANDROID_PILOT_TABLET_SETUP.md](ANDROID_PILOT_TABLET_SETUP.md#auto-start-e-otimização-de-bateria).
