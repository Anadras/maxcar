# MAXCAR — Motor de Sincronização (MAX-009)

Como o tablet unifica config, grade REGULAR, regras GEO, eventos pendentes
e comandos remotos num único ciclo, em vez de vários workers decidindo
"sincronizar" cada um a seu modo. Para o download/cache de mídia em si,
veja [ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md) e
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md) (manifesto REGULAR); para
GEO, veja [ANDROID_GEO_ENGINE.md](ANDROID_GEO_ENGINE.md).

## Um único coordenador

`sync/SyncCoordinator.kt` é o único lugar que executa um ciclo completo de
sincronização, sempre na mesma ordem de prioridade. Antes do MAX-009,
`HeartbeatWorker` e `MediaSyncWorker` eram dois jobs periódicos
independentes, cada um decidindo por conta própria o que "sincronizar"
significava — exatamente o cenário que o marco pede para evitar. Agora
existe um único worker (`work/SyncWorker.kt`) que apenas chama
`SyncCoordinator.runCycle()`.

## Ordem de prioridade

A lista de prioridades do marco (a que prevalece quando o fluxo conceitual
e a lista de prioridades divergem):

1. **Manter o player rodando** — não é um passo explícito: o coordenador
   roda inteiro fora da main thread (dentro de um `CoroutineWorker`) e
   nunca toca `ExoPlayer`/Compose diretamente. Não há como este código
   bloquear a reprodução, por construção.
2. **Credencial/heartbeat** — envia bateria, rede, GPS/GEO e o novo status
   de sincronização (`operationalStatus`, `pendingEventCount`,
   `clockSkewSeconds`) num único heartbeat. Uma resposta `401` interrompe o
   ciclo imediatamente (`SyncOutcome.UNAUTHORIZED`) — nada mais adiante
   teria sucesso com uma credencial revogada.
3. **Eventos pendentes** — `flushPendingEvents` (heartbeats enfileirados),
   `flushPlaybackEvents` (REGULAR e GEO, mesma função desde o MAX-008) e
   `GeoRepository.flushGeofenceEvents`, nessa ordem.
4. **Config + manifesto REGULAR + regras GEO** (itens 4 e 5 da lista do
   marco, tratados juntos) — `deviceRepository.refreshConfig()`,
   `mediaDownloadManager.sync()`, `geoRulesSyncManager.sync()`. Cada
   `sync()` já é ciente de versão/hash (só baixa o que mudou) e já faz sua
   própria troca atômica de grade — ver
   [ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md#download-atômico).
5. **Limpeza de cache** (item 6 da lista do marco) — não é um passo
   separado: está embutido no atomic swap de cada `sync()` do passo
   anterior.
6. **Comandos remotos** — `DeviceCommandExecutor.pollAndExecute()`, sempre
   por último. Ver [DEVICE_COMMANDS.md](../admin/DEVICE_COMMANDS.md).

## Cadência única

Antes: heartbeat a cada `heartbeat_interval_seconds` (padrão 15 min),
sincronização de mídia a cada `sync_interval_seconds` (padrão 60 min) —
dois agendamentos independentes. Agora: um único job periódico
(`DeviceWorkScheduler.scheduleSync`), rodando no intervalo de heartbeat
(o mais frequente dos dois) — já que todo ciclo inclui um heartbeat como
prioridade 2, manter essa cadência preserva a frequência de status que já
existia, e passa a sincronizar conteúdo com mais frequência do que antes.
O custo extra é pequeno: REGULAR e GEO só baixam o que realmente mudou.

`scheduleInitialSync` continua existindo para o primeiro ciclo (logo após
ativação ou a cada abertura do app com o dispositivo já ativado) e para
buscar a config remota antes de agendar o ciclo periódico com o intervalo
real do servidor. `syncNow` (botão "Sincronizar agora" no diagnóstico)
dispara um ciclo único, sem alterar o agendamento periódico.

## Versionamento

`manifestVersion` (REGULAR) e `rulesVersion` (GEO) são hashes de conteúdo
(ver [ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md#conteúdo-do-manifesto)),
reportados no heartbeat como sinal informativo para o painel. A decisão
real de baixar ou não cada item continua por hash individual do criativo —
nunca pela versão do conjunto inteiro — para que uma mudança pequena não
force o re-download de tudo.

## Retries e classificação de erro

`SyncOutcome` (`SUCCESS` / `UNAUTHORIZED` / `RETRY`) é a única tradução
entre o que aconteceu na rede e o que o `WorkManager` deve fazer:

| Situação                                                | `SyncOutcome`  | `Worker.Result`                                            |
| ------------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| Ciclo completo sem erro                                 | `SUCCESS`      | `success()` — próximo ciclo no agendamento normal          |
| Offline / timeout (`DeviceApiError.NetworkUnavailable`) | `SUCCESS`      | `success()` — não é uma falha, é o estado offline esperado |
| Credencial revogada/inválida (`401`)                    | `UNAUTHORIZED` | `failure()` — reativação resolve, retry não ajudaria       |
| Erro de servidor / inesperado                           | `RETRY`        | `retry()` — backoff exponencial padrão do WorkManager      |

Sem loop infinito: `WorkManager` aplica seu próprio backoff exponencial a
`Result.retry()`, e um `Result.failure()` simplesmente para até a próxima
ativação — nunca um retry manual em loop dentro do coordenador.

## Relógio do tablet — nunca confiado cegamente

`DeviceRepository.sendHeartbeat` calcula a divergência
(`clockSkewSeconds`) comparando o `recordedAt` da resposta (sempre o
relógio do servidor — nunca o do tablet, contrato inalterado desde o
MAX-006) com o relógio local no momento do envio, e persiste o valor para
o próximo ciclo reportar. Dois efeitos práticos:

- **Painel**: `device_heartbeats.clock_skew_seconds`, exibido no card
  "Sincronização" do detalhe do dispositivo — acima de 1 hora de
  diferença, o painel mostra um alerta em vez de só o número.
- **Expiração local offline**: `MediaDownloadManager.readyPlaylist` só
  filtra itens pelo `startsAt`/`endsAt` locais quando a divergência
  conhecida é menor que `SEVERE_CLOCK_SKEW_SECONDS` (1 hora) — um relógio
  claramente errado nunca apaga conteúdo por engano; ver
  [ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md).

## Conflitos: quem manda no quê

- **Servidor é fonte da verdade** para campanhas, regras GEO, vínculos
  (motorista/veículo/dispositivo) e configuração remota — o tablet nunca
  escreve nessas tabelas, só lê.
- **Tablet é fonte da verdade** para seus próprios eventos de reprodução,
  eventos GEO e telemetria coletada localmente (heartbeat) — o servidor
  nunca infere ou corrige esses valores, só os aceita via as RPCs
  idempotentes por `client_event_id`.

Não há, portanto, "merge" de dados conflitantes: cada lado só escreve no
que é seu.
