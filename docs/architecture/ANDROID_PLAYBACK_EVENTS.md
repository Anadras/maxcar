# MAXCAR — Eventos de reprodução offline (MAX-007)

Como uma exibição de vinheta vira prova de reprodução no servidor, mesmo
sem internet no momento em que aconteceu.

## Modelo: um evento finalizado, não um par início/fim

Ao contrário do que se poderia esperar, o Android **não** envia "iniciou" e
depois "concluiu" como duas chamadas de rede separadas. `PlayerViewModel`
só enfileira localmente (`DeviceRepository.recordPlaybackEvent`) quando a
reprodução **já terminou** — com sucesso, por erro, ou (numa próxima
sessão, ver abaixo) por ter sido interrompida por um fechamento do
app/reinício do tablet. O que sincroniza depois é sempre um registro
completo, nunca um evento "ainda tocando".

Isso mantém o lado servidor simétrico ao do heartbeat (MAX-006): uma única
inserção idempotente, nunca um update-in-place. `impressions.status =
'started'` continua um valor válido no enum, reservado para um uso futuro
(ex.: GEO em tempo real), não usado por este fluxo.

## Campos registrados localmente

`PlaybackEventEntity` (Room): `clientEventId`, `campaignId`, `creativeId`,
`status` (`completed`/`interrupted`/`failed`), `startedAt`, `completedAt`,
`durationMs`, `completionPercentage`, `failureReason`, `offline`,
`createdAt`, `attemptCount`. Sem GPS neste marco — `impressions.location`
continua sem uso pelo Android até o Location Engine (MAX-008).

## Início e conclusão

- Um evento é criado quando o item **realmente começa** a tocar
  (`PlayerViewModel.playCurrent`, guarda `itemStartedAtIso`).
- É marcado `completed` só quando o vídeo chega ao fim
  (`Player.STATE_ENDED`) ou a imagem cumpre sua duração.
- Se o app fecha, o processo morre, ou o item falha
  (`onPlayerError`), o evento sincronizado carrega `status = 'failed'` com
  `failureReason` — nunca é silenciosamente descartado nem contado como
  sucesso.

## Idempotência

Cada evento tem seu próprio `clientEventId` (UUID, gerado no momento em que
a reprodução termina). O servidor (`record_device_playback_event`) insere
em `impressions` com
`on conflict (device_id, client_event_id) do nothing` — o mesmo padrão de
`impressions_idempotency_unique` (MAX-002) e de `record_device_heartbeat`
(MAX-006). Um reenvio depois de uma resposta perdida nunca duplica a
impressão.

## Sincronização

`POST /functions/v1/device-playback-events`,
`Authorization: Bearer <device token>`, corpo `{ "events": [...] }` — um
lote de até 50 eventos por chamada (`MAX_EVENTS_PER_REQUEST` na Edge
Function). O `device_id` é sempre derivado do token, nunca enviado pelo
Android.

Resposta: `{ "results": [{ "clientEventId", "ok", "recorded" }] }` — um
resultado por evento enviado, para o Android saber exatamente quais linhas
locais apagar. Um evento malformado no meio do lote não derruba os demais;
cada um é processado e reportado individualmente
(`device-playback-events/index.ts`).

`DeviceRepository.flushPlaybackEvents`:

- poda eventos com mais de 7 dias antes de tentar enviar (mesma retenção do
  MAX-006 para heartbeats pendentes — `RETENTION_MILLIS`);
- envia até 20 por vez (`limit` default);
- remove localmente só os eventos com `ok: true` na resposta;
- em falha de rede, a fila fica intacta para a próxima tentativa;
- em `401`, trata como credencial revogada e volta para a tela de
  ativação (mesma regra do MAX-006) — os eventos continuam na fila, prontos
  para reenviar após uma nova ativação.

Disparado a cada ciclo do `HeartbeatWorker`, junto com o flush de
heartbeats pendentes — não há um worker dedicado só para isso; agrupar no
mesmo ciclo periódico evita um agendamento adicional para um volume de
dados pequeno.

## Retenção local

Fila limitada por tempo (7 dias, poda automática) e por lote de envio (até
50 no servidor, até 20 por tentativa no cliente) — prioriza confiabilidade
sem deixar o armazenamento crescer sem limite num tablet que ficou offline
por muito tempo.
