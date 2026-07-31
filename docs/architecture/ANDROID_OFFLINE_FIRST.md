# MAXCAR — Offline-first no Android (MAX-006)

Cobre a fundação offline introduzida neste marco: estado local, fila de
eventos pendentes e sincronização em segundo plano. Não cobre player, mídia
ou GEO — isso é offline-first também, mas chega em MAX-007/008 sobre esta
mesma base.

## Room

`data/local/AppDatabase.kt`, versão 1, `exportSchema = false` (deliberado:
revisitar quando migrations de schema local importarem). Três tabelas:

- `DeviceStateEntity` — o retrato mais recente de identidade e vínculo:
  `deviceId`, `deviceCode`, `vehicleId`/`vehicleCode`, `lastHeartbeatAt`,
  `lastSyncAt`. Uma linha só; reescrita a cada ativação e a cada
  heartbeat/sync bem-sucedido.
- `RemoteConfigEntity` — a configuração remota mais recente
  (`heartbeatIntervalSeconds`, `syncIntervalSeconds`, `kioskEnabled`,
  `loggingLevel`, `configVersion`), com `defaults()` (900s/3600s) para quando
  o app nunca sincronizou ainda.
- `PendingEventEntity` — heartbeats que falharam por rede e aguardam
  reenvio, com índice único em `clientEventId` (mesmo idempotency key aceito
  pelo backend).

Nenhuma dessas tabelas guarda o token do dispositivo — isso vive só em
`SecureTokenStore` (Keystore). Ver [DEVICE_SECURITY.md](DEVICE_SECURITY.md).

## DataStore

`AppPreferences` (Preferences DataStore) guarda deliberadamente uma única
coisa: a flag `isEnrolled`. Qualquer estado mais rico pertence ao Room. O
`installation_id` tem seu próprio `InstallationIdStore`, sobre o mesmo
DataStore compartilhado (`Context.dataStore`, `di/AppContainer.kt`) — gerado
uma vez com `UUID.randomUUID()` e nunca reescrito.

## Fila de heartbeats pendentes

`DeviceRepository.sendHeartbeat()` tenta o envio direto; se
`DeviceApiError.NetworkUnavailable`, o heartbeat vira uma linha em
`PendingEventEntity` em vez de ser descartado. Uma resposta de
`Unauthorized` (401), ao contrário, nunca enfileira — trata-se de revogação,
não de rede indisponível (ver [DEVICE_SECURITY.md](DEVICE_SECURITY.md)).

`flushPendingEvents(limit = 20)`:

1. Poda entradas com mais de 7 dias (`RETENTION_MILLIS`) antes de tentar
   qualquer envio — um tablet offline por mais de uma semana não acumula
   fila indefinidamente.
2. Envia da mais antiga para a mais nova, **parando no primeiro erro** para
   preservar a ordem — eventos fora de ordem seriam pior que eventos
   atrasados.
3. Reusa o `clientEventId` original em cada tentativa, então um reenvio que
   chega duplicado no servidor é absorvido pelo
   `ON CONFLICT (device_id, client_event_id) DO NOTHING` de
   `record_device_heartbeat` — sem heartbeat duplicado, sem heartbeat
   perdido.

## WorkManager

`work/DeviceWorkScheduler.kt` agenda dois workers, ambos exigindo
`NetworkType.CONNECTED`:

- `InitialSyncWorker` (one-time, `ExistingWorkPolicy.REPLACE`) — disparado
  uma vez logo após a ativação bem-sucedida. Busca a config remota
  (`device-config`) e, se der certo, agenda o heartbeat periódico com o
  `heartbeatIntervalSeconds` recebido do servidor.
- `HeartbeatWorker` (periodic, `ExistingPeriodicWorkPolicy.UPDATE`) — a cada
  ciclo, primeiro chama `flushPendingEvents()`, depois envia um heartbeat
  novo com telemetria fresca (`DeviceTelemetry.collect`). O intervalo pedido
  pelo servidor é sempre elevado ao mínimo de 15 minutos do WorkManager
  (`maxOf(intervalSeconds, MIN_INTERVAL_SECONDS)`) — WorkManager rejeitaria
  um período menor de qualquer forma.

Mapeamento de resultado do `HeartbeatWorker`:

| Resultado do repositório | `Result` do worker | Por quê                                                         |
| ------------------------ | ------------------ | --------------------------------------------------------------- |
| Sucesso                  | `success()`        | —                                                               |
| `NetworkUnavailable`     | `success()`        | já ficou na fila local; o próximo ciclo periódico tenta de novo |
| `Unauthorized`           | `failure()`        | precisa reativação; tentar de novo não ajuda                    |
| qualquer outro erro      | `retry()`          | WorkManager decide o backoff                                    |

## Telemetria coletada (`work/DeviceTelemetry.kt`)

Bateria (`BatteryManager`), tipo de rede (`ConnectivityManager` — wifi,
celular, ethernet tratado como wifi, ou offline) e espaço livre
(`StatFs` sobre `Environment.getDataDirectory()`). Nada disso pede permissão
além de `ACCESS_NETWORK_STATE`, já declarada no manifest. Sem GPS — a coluna
`device_heartbeats.location` existente no schema (MAX-005) continua sem uso
pelo Android até o Location Engine chegar em MAX-007/008.
