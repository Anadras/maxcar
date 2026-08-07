# MAXCAR — Operação local do media-worker (MAX-018)

O pipeline de mídia (`apps/media-worker` + as migrations de
`supabase/migrations/20260822090000_media_processing_pipeline.sql` em
diante) já existe e está completo. Esta etapa não criou infraestrutura
nova: decidiu deliberadamente **não** hospedar o worker em nuvem por
enquanto — ele roda localmente, sob demanda, no Mac de quem estiver
operando, sempre que houver mídia para processar.

Este documento é o suficiente para operar isso no dia a dia. Para a
arquitetura completa do pipeline (por que não uma Edge Function, o
`Dockerfile`, o design de retry), ver
`docs/architecture/MEDIA_VALIDATION_PIPELINE_PROPOSAL.md`.

## Quando ligar o worker

Sempre que houver um criativo em `uploaded`, `queued` ou qualquer estado
intermediário do pipeline (`probing`/`transcoding`/`validating_output`) —
visível em `/midia` no admin, no card "PROCESSANDO". Isso acontece:

- Depois de qualquer upload novo de mídia pelo admin (o upload já
  enfileira o job automaticamente).
- Depois de clicar "Reprocessar" em um criativo `incompatible`/`failed`,
  ou de rodar `reprocess_creative` pelo fluxo oficial.

Sem o worker rodando, o job fica parado em `queued` indefinidamente — não
há nada quebrado, só ninguém para pegar o trabalho.

## Como iniciar

Pré-requisitos (uma vez só por máquina):

```bash
brew install ffmpeg   # fornece ffmpeg + ffprobe no PATH
which ffmpeg ffprobe   # confirma que os dois existem
```

Dependências do projeto já vêm do monorepo (`npm install` na raiz cobre
`apps/media-worker`, que não tem `node_modules` próprio).

Secrets: crie `apps/media-worker/.env` (já está no `.gitignore` — nunca
commitar) com, no mínimo:

```env
SUPABASE_URL=https://cdciyuwikdzofaaxvdbp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key do projeto>
MEDIA_WORKER_ID=local-dev-<seu-nome>
MEDIA_WORKER_BUCKET=campaign-media
```

Os demais valores (`MEDIA_WORKER_POLL_INTERVAL_MS`,
`MEDIA_WORKER_STALE_JOB_TIMEOUT_SECONDS` etc.) têm default razoável em
`apps/media-worker/src/config.ts` — só sobrescreva se souber por quê. Veja
`.env.example` para o formato completo.

**Ponto de atenção real**: `config.ts` lê `process.env` diretamente, sem
`dotenv` — `npm run dev` sozinho **não** carrega o `.env`. É preciso
exportar as variáveis explicitamente antes:

```bash
cd apps/media-worker
set -a && source .env && set +a
npm run dev
```

(Alternativa equivalente, não testada nesta etapa: `node --env-file=.env`
diretamente sobre o `dist/index.js` depois de `npm run build`.)

Para rodar em segundo plano e acompanhar por log:

```bash
cd apps/media-worker
set -a && source .env && set +a
nohup npm run dev > worker.log 2>&1 &
```

## Como verificar que está funcionando

```bash
curl -s http://localhost:8080/health
```

Retorna `{"ready":true,"lastClaimAttemptAt":"...","lastError":null}` com
HTTP 200 quando saudável, ou 503 se algo está impedindo o loop principal
(porta configurável via `MEDIA_WORKER_HEALTH_PORT`).

O log de início mostra:

```
[<MEDIA_WORKER_ID>] media worker started, bucket=<bucket>
```

## Como acompanhar o processamento

Pelo log (`tail -f worker.log`), cada job aparece como:

```
[worker-id] claimed job <job-id> for creative <creative-id>
[worker-id] finished job <job-id>
```

`finished` significa que o worker concluiu o ciclo e reportou um estado
terminal — não necessariamente sucesso; um `incompatible`/`failed`
legítimo também termina com `finished`. Para o resultado real, consulte
`campaign_creatives.processing_status` (visível em `/midia` no admin) ou
`media_processing_jobs` para o histórico completo daquele criativo.

O caminho normal de um job: `uploaded → queued → probing → transcoding →
validating_output → ready` (ou `→ incompatible` se o resultado não passar
na validação técnica, ou `→ failed` após esgotar as tentativas em uma
falha transitória).

## Como identificar conclusão

Um criativo terminou o pipeline quando `processing_status = 'ready'` **e**
`processed_storage_path`, `processed_media_probe` e `compatibility_profile`
estão preenchidos. Isso é o que libera a campanha para ficar
estruturalmente pronta (`private.campaign_is_structurally_ready`) e o que
o manifesto do dispositivo (`get_device_manifest`/`get_device_geo_rules`)
exige antes de servir o arquivo a um tablet.

## Como parar

`Ctrl+C` (SIGINT) ou `kill <pid>` (SIGTERM) — `index.ts` já trata os dois
sinais graciosamente: termina o job em andamento antes de sair, não deixa
nada pela metade. Não use `kill -9`: o único risco real é o diretório
temporário do job atual não ser limpo (o `finally` em `job.ts` cobre todo
outro caminho de saída, inclusive exceptions).

## Erros comuns

**`Missing required environment variable: SUPABASE_URL`** — o `.env` não
foi exportado antes de `npm run dev` (ver "Como iniciar" acima).

**Job preso em `processing` sem nunca terminar** — normalmente o worker
morreu no meio do job (crash, máquina suspensa). `reclaim_stale_media_
processing_jobs` roda automaticamente no topo de cada loop do worker; um
job assim se recupera sozinho depois de `MEDIA_WORKER_STALE_JOB_TIMEOUT_
SECONDS` (900s por padrão) — não precisa de intervenção manual, só
esperar o próximo ciclo (ou o worker ser reiniciado, que já dispara essa
varredura na primeira iteração).

**`An active campaign cannot lose its required structure.` (23514) ao
chamar `reprocess_creative`** — bug real encontrado e corrigido nesta
etapa (ver "Bugs encontrados e corrigidos" abaixo). Se isso voltar a
aparecer para algum caso novo não coberto, é um problema de causa raiz no
gate de prontidão estrutural, não algo para contornar manualmente.

## Bugs encontrados e corrigidos nesta etapa (MAX-018)

Reprocessar `reg03`/`regular04` pelo fluxo oficial (`reprocess_creative`)
expôs quatro bugs reais e não-óbvios no pipeline — nenhum deles específico
dessas duas mídias; todos afetavam (ou afetariam) qualquer reprocessamento
em circunstâncias normais. Cada um foi corrigido por uma migration
própria, validada no shadow project com pgTAP antes do push para staging:

1. **`campaign_is_structurally_ready` não tolerava um criativo em
   processamento pela primeira vez** — `reprocess_creative` movia o
   criativo para `queued`, o que derrubava a única condição de prontidão
   estrutural de uma campanha ativa cujo único criativo nunca tinha sido
   processado com sucesso antes. Corrigido em
   `20260827090000_reprocess_active_campaign_fix.sql`: o gate agora também
   aceita estados intermediários do pipeline (`queued` até
   `validating_output`), nunca `failed`/`incompatible`. O gate de
   *veiculação* real (`get_device_manifest`/`get_device_geo_rules`) não
   foi tocado — continua exigindo `ready` ou `processed_storage_path` não
   nulo.
2. **`original_storage_path` nunca era preenchido por ninguém** — nem o
   upload do admin, nem nenhum trigger. O worker recebia esse campo como
   `null` e travava em todo job (`Cannot read properties of null (reading
   'split')`), sempre, não só para mídia legada. Corrigido em
   `20260827093000_backfill_original_storage_path_on_enqueue.sql`:
   `enqueue_media_processing_job` agora preenche esse campo a partir de
   `storage_path` no momento de enfileirar.
3. **Um job superado por um reprocessamento mais novo podia travar para
   sempre, ou sobrescrever o resultado atual** — `report_media_processing_
   result`, `report_media_processing_progress` e `reclaim_stale_media_
   processing_jobs` não verificavam se o job que estava reportando ainda
   era a versão atual do criativo (`processing_version`). Um job "zumbi"
   (de uma versão antiga) tentando reportar `failed` sobre o único
   criativo ativo de uma campanha ativa esbarrava no mesmo gate do item 1
   e ficava travado em `processing` para sempre — reproduzido ao vivo
   nesta etapa com os dois jobs originais de `reg03`/`regular04`.
   Corrigido em `20260827094500_ignore_stale_media_processing_reports.sql`
   e `20260827100000_reclaim_ignores_stale_media_versions.sql`: um job cuja
   `media_version` não bate mais com a versão atual do criativo se encerra
   sozinho (registra seu próprio resultado, nunca escreve em
   `campaign_creatives`).

Todos os quatro têm teste de regressão pgTAP dedicado (`supabase/tests/
023_media_processing_pipeline.test.sql` e `027_media_pipeline_safe_
default.test.sql`).

## Pendência conhecida, não corrigida nesta etapa

A política de leitura de `storage.objects` para o bucket `campaign-media`
(`private.can_access_campaign_media`, em
`20260728090700_campaign_media_and_geofence_operations.sql`) só reconhece
o padrão de caminho original
(`advertisers/{id}/campaigns/{id}/{creativeId}.ext`) — nenhuma sessão
autenticada do admin (nem `super_admin`) consegue ler um derivado em
`media-processed/...` diretamente. **Isso não afeta o tablet**: o
`device-manifest`/`device-geo-rules` (Edge Functions) usam um cliente
`service_role`, que ignora RLS, e foi isso que foi usado para confirmar
que os arquivos processados de `reg03`/`regular04` existem de fato no
Storage. Também não afeta nada hoje no admin, que só cria signed URLs para
`storage_path` (o original), nunca para `processed_storage_path`. Fica
registrado para quando o admin ganhar algum recurso de preview do
derivado processado — o ajuste seria estender a regex dessa função para
também aceitar `media-processed/{creativeId}/{version}-{hash}.ext`.

## Fluxo oficial (a partir de agora)

```
Upload (admin)
  → campaign_creatives.processing_status = 'uploaded'
  → enqueue_media_processing_job (automático no upload)
  → MEDIA WORKER LOCAL (ligado sob demanda, conforme este documento)
      probing → transcoding → validating_output
  → validação técnica (compatibility.ts): codec, profile, pixel format,
    áudio, duração, tamanho do arquivo
  → READY (processed_storage_path + compatibility_profile preenchidos)
  → campanha pode ficar/ficar ativa (campaign_is_structurally_ready)
  → tablet sincroniza no próximo ciclo natural e reproduz
```

Nenhuma mídia é publicada sem passar por esse fluxo: uma linha nova nunca
nasce `ready` (default da coluna é `uploaded`, e há um trigger que rejeita
qualquer INSERT que tente reivindicar `ready` sem `processed_storage_path`
— ver `20260826090000_media_pipeline_safe_default.sql`).
