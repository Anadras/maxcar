# MAXCAR — Manifesto e sincronização de mídia (MAX-007)

Como o tablet descobre o que deve reproduzir e mantém isso atualizado. Para
o que acontece com os bytes depois de baixados, veja
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md).

## Endpoint

`GET /functions/v1/device-manifest`, `Authorization: Bearer <device
token>` — mesmo esquema de autenticação do MAX-006 (`device-enroll`,
`device-heartbeat`, `device-config`). O `device_id` nunca vem do Android:
`get_device_manifest` (SQL) deriva-o do hash do token, via
`private.device_id_for_token`, exatamente como as demais RPCs de
dispositivo.

## Conteúdo do manifesto

```json
{
  "manifestVersion": "78b02c0559362d46c347a35b664bf956",
  "generatedAt": "2026-08-03T23:17:08Z",
  "deviceId": "97000000-0000-4000-8000-000000000001",
  "playlist": [
    {
      "campaignId": "...",
      "creativeId": "...",
      "type": "video",
      "mimeType": "video/mp4",
      "durationSeconds": 15.0,
      "fileSizeBytes": 2000000,
      "sha256": "...",
      "downloadUrl": "https://.../storage/v1/object/sign/campaign-media/...",
      "startsAt": "...",
      "endsAt": "...",
      "position": 1
    }
  ]
}
```

`manifestVersion` é um hash de conteúdo (`md5` sobre `creativeId:checksum`
de cada item, na ordem da grade) — não um contador incrementado
manualmente. Dois manifestos com o mesmo conteúdo, na mesma ordem, têm a
mesma versão; qualquer mudança de conteúdo ou ordem muda a versão. O
Android usa isso só como sinal informativo (relatado no heartbeat); a
decisão real de re-baixar ou não cada item é por hash individual do
criativo, não pela versão do manifesto como um todo — ver
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md#o-que-dispara-um-download).

## Elegibilidade (server-side, `get_device_manifest`)

Um item só entra na grade se a campanha:

- `campaign_type = 'regular'` (GEO nunca aparece aqui — pertence ao futuro
  Location Engine);
- `status = 'active'`;
- estiver dentro do período (`starts_at`/`ends_at`);
- for estruturalmente pronta — reaproveita
  `private.campaign_is_structurally_ready`, a mesma função usada pelo
  painel (MAX-004) para o botão de ativação. Uma única fonte de verdade
  para "essa campanha pode rodar", não uma regra duplicada para o
  dispositivo.

O criativo usado é o mais antigo ativo da campanha
(`campaign_creatives.active = true`, `order by created_at`).

## Vínculo entre playlist e dispositivo

`playlists.device_id` (nullable, `on delete cascade`) — adicionado neste
marco. Uma playlist com `device_id` definido é específica daquele tablet;
uma playlist com `device_id is null` é a **grade padrão do piloto**, usada
por qualquer dispositivo sem grade própria. Índices únicos parciais
garantem no máximo uma playlist ativa por dispositivo e, separadamente, no
máximo uma grade padrão global ativa
(`playlists_one_active_per_device`, `playlists_one_active_global_default`).

`get_device_manifest` procura primeiro uma playlist específica do
dispositivo; se não existir, cai para a grade padrão. Isso é decidido
inteiramente no servidor — o Android nunca escolhe nem sabe qual das duas
está sendo usada, só recebe o resultado.

Só campanhas REGULAR podem entrar numa playlist: um trigger
(`playlist_items_validate_campaign_type`) rejeita a inserção de uma
campanha GEO com `23514`, espelhando a regra simétrica que já impedia uma
campanha REGULAR de receber geofence (MAX-004).

## No painel

Card "Grade regular do piloto" no detalhe de uma campanha REGULAR
(`/campanhas/[id]`, visível para `super_admin`/`admin`/`operations`):
inclui/remove a campanha da grade padrão global, sem SQL. Cria a playlist
padrão sob demanda no primeiro uso
(`apps/admin/app/(protected)/campanhas/[id]/playlist-actions.ts`). Vínculo
dispositivo-específico ainda não tem UI dedicada — pode ser adicionado
depois sem mudar o contrato do manifesto, escrevendo diretamente
`playlists.device_id` (já suportado no schema e na RPC).

## URL de download

`get_device_manifest` (SQL) não inclui `downloadUrl` — assinar uma URL
exige a API de Storage, que só existe no cliente JS/HTTP, não em SQL. A
Edge Function `device-manifest` chama
`supabase.storage.from('campaign-media').createSignedUrl(path, 1800)` para
cada item depois de receber o resultado da RPC. 1800 segundos (30 min): o
suficiente para um download real em 4G instável, curto o bastante para
nunca ser tratado como credencial permanente. O Android nunca persiste essa
URL — ela é usada uma vez, no ciclo de sync em que chegou; uma nova
sincronização sempre traz uma nova URL.

## Quando o Android sincroniza

`work/MediaSyncWorker.kt` chama `MediaDownloadManager.sync()`. Agendado por
`DeviceWorkScheduler`:

- **Periódico**: `scheduleMediaSync(context, sync_interval_seconds)` — o
  intervalo vem do `RemoteConfig` já existente do MAX-006, nunca decidido
  pelo tablet; respeita o mínimo de 15 minutos do `PeriodicWork` do
  WorkManager.
- **Ao ativar e a cada abertura do app**: `scheduleInitialSync` busca a
  config remota e reagenda heartbeat e media sync com o intervalo atual,
  além de disparar `syncMediaNow()` uma vez. Chamado logo após uma
  ativação bem-sucedida e também a cada vez que `MainActivity` observa
  `isEnrolled = true` — reagendar é idempotente
  (`ExistingWorkPolicy.REPLACE` / `ExistingPeriodicWorkPolicy.UPDATE`), e é
  esse segundo gatilho que garante que um tablet atualizado de uma versão
  mais antiga do app (sem o worker de mídia agendado) volte a sincronizar
  sem precisar de uma nova ativação.
- **Manual**: botão "Sincronizar agora" no diagnóstico
  (`DeviceHomeViewModel.syncMediaNow`) — mesmo caminho do `syncMediaNow`,
  como trabalho único imediato, sem substituir o agendamento periódico.

Sem polling agressivo: o único gatilho "ao reconectar" é a própria
constraint `NetworkType.CONNECTED` do WorkManager, que libera o trabalho
periódico pendente assim que a rede volta — não há um listener de
conectividade adicional.
