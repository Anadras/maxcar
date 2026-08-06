# MAXCAR — Proposta técnica: pipeline de validação/transcodificação de mídia (MAX-013)

Este é um projeto técnico, não uma implementação. Nada aqui foi implantado.
Documenta arquitetura, contratos, estados e plano de rollout para que a
decisão de construir (ou não) seja informada — ver a seção "Por que não em
uma Edge Function" para o motivo real de isto não ter sido feito
diretamente.

## Por que não em uma Edge Function Deno

Supabase Edge Functions rodam em Deno Deploy: sem sistema de arquivos
persistente de propósito geral, sem binário `ffmpeg`/`ffprobe` disponível,
e sem forma suportada de instalar um. `ffprobe`/`ffmpeg` são binários
nativos (não pacotes npm/Deno) — não há alternativa "instalar via import"
que funcione nesse runtime. Tentar embutir um build WASM do ffmpeg é
tecnicamente possível, mas troca um problema de infraestrutura por um de
performance/memória dentro de um ambiente serverless com limites de tempo
de execução — não é a base certa para transcodificação de vídeo.

## Arquitetura proposta

```
Upload (admin, já existe)
  → campaign_creatives.status = 'uploaded'
  → Supabase Database Webhook (INSERT em campaign_creatives)
      ↓ HTTP POST assinado
  Worker dedicado (fora do Supabase, container próprio)
      1. baixa o arquivo original do Storage
      2. ffprobe → perfil técnico completo
      3. compara contra o "perfil seguro" (ver abaixo)
      4. se já compatível → valida frames decodificáveis → READY
      5. se fora do perfil → ffmpeg → gera derivado → ffprobe no derivado
         → valida → upload do derivado → READY
      6. se falha em qualquer etapa → INCOMPATIBLE, motivo registrado
      ↓ RPC assinado (mesma família de autenticação de device-*, mas para
        o worker, não para o tablet)
  Postgres: campaign_creatives atualizado, audit_events registrado
```

### Serviço responsável

**Fly.io** é a recomendação, entre as opções avaliadas:

| Opção | Prós | Contras |
|---|---|---|
| **Fly.io (recomendado)** | Containers persistentes, disco local temporário rápido (bom para ffmpeg), preço previsível por VM, deploy simples via `fly.toml`, região próxima ao Supabase (`gru`/São Paulo) | Mais uma conta/plataforma para operar |
| Cloud Run | Serverless, escala a zero, bom para picos | Timeout máximo de request (60 min no Cloud Run, mas cold start + billing por CPU-time fica caro para jobs longos de vídeo; sem disco persistente entre execuções) |
| Railway | Muito simples de configurar | Menos controle de região/recursos; menos maduro para workloads de CPU sustentada |
| Container Supabase (self-managed) | Nenhuma conta nova | Supabase não oferece compute genérico para workers — só Edge Functions (Deno) e Postgres |

Fly.io vence porque ffmpeg é CPU/disco-intensivo e de duração variável
(um vídeo de 30s pode levar segundos, um de perfil muito fora do padrão
pode levar minutos) — um container persistente com fila própria lida com
isso melhor que serverless-por-request.

### Fila de processamento

- Uma tabela `public.media_processing_jobs` (nova) como fila:
  `id, creative_id, status, attempts, last_error, created_at, started_at, finished_at`.
- O worker faz polling curto (a cada poucos segundos) via uma função
  `claim_next_media_processing_job()` (`SELECT ... FOR UPDATE SKIP LOCKED`,
  o padrão padrão de fila em Postgres) — não precisa de um message broker
  separado (SQS/Rabbit) no volume esperado deste piloto (dezenas de
  criativos por semana, não milhares).
- Alternativa mais simples ainda, se o volume continuar baixo: o worker
  simplesmente faz polling direto em `campaign_creatives where status =
  'uploaded'` — a tabela de fila só compensa quando o volume ou a
  necessidade de retry/observabilidade crescer.

### Storage de origem e derivado

- Original: mantido no bucket já existente (`campaign-media`), nunca
  sobrescrito — auditoria/reprocessamento sempre podem voltar a ele.
- Derivado: mesmo bucket, path irmão (`.../original.mp4` →
  `.../transcoded.mp4`), hash novo, linha própria em
  `campaign_creatives` (`source_creative_id` apontando para o original) ou
  um campo `derived_from_creative_id` — a decisão exata de modelagem
  (nova linha vs. atualizar a mesma) fica para quando isto for
  implementado, mas a orientação é: nunca perder o original.

## Perfil técnico seguro (proposto para este hardware)

Baseado no que já se sabe deste piloto (Black Shark/MediaTek,
`c2.mtk.avc.decoder`) e em prática de mercado para decodificação de
hardware ampla:

| Parâmetro | Valor |
|---|---|
| Container | MP4, `faststart` (moov no início do arquivo) |
| Vídeo | H.264/AVC, profile **Main** ou **Baseline** (nunca High 10/4:2:2) |
| Level | ≤ 4.1 |
| Pixel format | yuv420p |
| Frame rate | ≤ 30fps, constante (não variável) |
| Resolução | proporcional à orientação/proporção da campanha, máximo 1920×1200 |
| Bitrate | moderado — teto sugerido 8 Mbps para 1080p |
| GOP | ≤ 2s (keyframe a cada ≤60 frames a 30fps) |
| B-frames | permitido, mas não excessivo (≤2 consecutivos) — perfis com B-frame muito agressivo são a suspeita não-comprovada mais plausível para o incidente da regular02 (ver seção 30 do brief original: motivo exato não pôde ser provado sem o arquivo original disponível para reanálise) |
| Áudio | AAC-LC, ≤48kHz, estéreo ou mono |
| Trilhas | uma de vídeo, uma de áudio opcional — nunca trilhas extras |
| Rotation metadata | nunca presente (vídeo já deve estar na orientação correta) |

## Comandos ffprobe/ffmpeg

Validação (não muta nada):

```sh
ffprobe -v error -show_entries \
  stream=codec_name,codec_type,profile,level,pix_fmt,width,height,r_frame_rate,bit_rate \
  -show_entries format=duration,size \
  -of json input.mp4
```

Transcodificação para o perfil seguro:

```sh
ffmpeg -i input.mp4 \
  -c:v libx264 -profile:v main -level 4.1 -pix_fmt yuv420p \
  -r 30 -g 60 -bf 2 \
  -b:v 6M -maxrate 8M -bufsize 12M \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart \
  output.mp4
```

Validação de frames decodificáveis (fail-fast em arquivo truncado/corrompido):

```sh
ffmpeg -v error -i input.mp4 -f null - 2>decode_errors.log
# decode_errors.log vazio = decodificável do início ao fim
```

## Estados (`campaign_creatives.status` — novo enum ou coluna adicional)

```
uploaded → processing → validating → (transcoding →)? ready
                                   ↘ incompatible
                       ↘ failed (erro de infraestrutura, não do arquivo — retry automático)
```

- `ready`: único estado em que `get_device_manifest` pode incluir o
  criativo — este ponto já é reforçado pelo código atual
  (`private.campaign_is_structurally_ready`), só precisa passar a
  considerar este novo status em vez de assumir "upload concluído =
  pronto".
- `incompatible`: terminal, nunca reprocessado automaticamente — exige
  reupload.
- `failed`: transitório (timeout de rede, worker reiniciado no meio) —
  até 3 tentativas automáticas com backoff, depois vira `incompatible`
  com motivo "falha de infraestrutura após N tentativas".

## Webhook / polling

Recomendado: **Supabase Database Webhook** (`campaign_creatives` INSERT/
UPDATE de status) → HTTP POST assinado (HMAC com um segredo compartilhado,
mesmo padrão de `verify_jwt = false` + segredo próprio que várias Edge
Functions deste projeto já usam) para o worker. Fallback: se o worker
estiver fora do ar quando o webhook dispara, um polling de baixa
frequência (a cada 1-2 min) no worker cobre o que o webhook perdeu — nunca
depender de um único mecanismo de disparo.

## Observabilidade

- `media_processing_jobs.last_error` — texto curto, nunca stack trace
  completo armazenado no banco (mesma regra de `failure_reason` já usada
  em `impressions`/`device_heartbeats`).
- Logs estruturados do worker (JSON por linha) para um serviço de log
  gerenciado do próprio Fly.io (`fly logs`) — sem necessidade de um novo
  serviço de observabilidade só para isto neste volume.
- `audit_events` já existente ganha uma ação nova (`media_transcoded`/
  `media_marked_incompatible`) para cada transição terminal.

## Custos aproximados

Baseado em volume de piloto (dezenas de criativos/semana, cada
processamento levando segundos a poucos minutos de CPU):

- Fly.io: uma VM pequena (shared-cpu-1x, 256MB-1GB) já processa esse
  volume com folga — na faixa de **US$5-10/mês** rodando 24/7, ou menos
  se configurada para escalar a zero entre jobs (Fly Machines suporta
  start-on-demand).
- Sem custo adicional de storage novo relevante (deriva usa o bucket já
  existente).
- Sem custo de fila externa (Postgres já cobre o volume esperado).

Se o volume crescer para centenas de uploads/dia, revisar para uma VM
dedicada maior ou paralelização com múltiplos workers — não é o cenário
atual.

## Segurança

- Worker autentica no Supabase via uma chave de serviço própria (não a
  `SUPABASE_SERVICE_ROLE_KEY` do painel/tablet — uma credencial dedicada,
  escopo mínimo: ler `campaign_creatives`/`media_processing_jobs`,
  escrever apenas nessas mesmas tabelas e no Storage do bucket
  `campaign-media`).
- Segredo do webhook nunca no código-fonte — variável de ambiente no Fly.io,
  igual ao padrão já usado para as chaves do Supabase nas Edge Functions.
- Arquivo original nunca exposto publicamente durante o processamento — o
  worker baixa via signed URL de curta duração, mesmo padrão que
  `MediaDownloadManager` já usa no lado do tablet.

## Rollback

- Nenhuma migration deste projeto precisa alterar dados existentes: todo
  criativo já `READY` hoje continua `READY` (a nova coluna de status
  nasce com um valor de migração equivalente a "já validado", não
  reprocessa o histórico).
- Se o worker apresentar problemas em produção, o pipeline pode ser
  desligado (parar de consumir o webhook/fila) sem quebrar uploads
  existentes — o painel volta ao comportamento atual (upload = pronto)
  bastando não bloquear a publicação em `status != 'ready'` enquanto o
  worker estiver fora.

## Plano de implantação (quando autorizado)

1. Migration: nova coluna/estado em `campaign_creatives`, tabela
   `media_processing_jobs`, RPC `claim_next_media_processing_job`, RPCs
   para o worker reportar resultado — tudo aditivo, pgTAP cobrindo os
   estados e transições.
2. Worker: projeto novo (`services/media-worker` ou repositório próprio),
   `ffmpeg`/`ffprobe` via imagem Docker oficial (`jrottenberg/ffmpeg` ou
   similar como base), lógica de polling/processamento, testes unitários
   dos comandos ffprobe/ffmpeg contra fixtures conhecidas (um vídeo válido,
   um fora de perfil, um corrompido).
3. Painel: bloquear publicação de campanha com criativo fora de `ready`,
   mostrar status/motivo (seção 31 do brief original).
4. Piloto controlado: rodar em paralelo ao fluxo atual por um período,
   sem bloquear publicações, apenas registrando o que teria acontecido —
   só then trocar para bloqueante.
5. Reprocessar (opcional, sob demanda) o histórico de criativos já
   publicados, para gerar visibilidade retroativa do perfil técnico real
   em uso — nunca automático/silencioso sobre campanhas já ativas.

## Testes (quando implementado)

- pgTAP: transições de estado válidas/inválidas, RLS de
  `media_processing_jobs`, `claim_next_media_processing_job` não permite
  dois workers pegarem o mesmo job (`FOR UPDATE SKIP LOCKED`).
- Worker: testes de unidade para o parsing do `ffprobe` JSON e a decisão
  "dentro do perfil" vs. "precisa transcodificar" vs. "incompatível
  mesmo depois de transcodificar", contra fixtures reais (não mockadas)
  de vídeo.
- Integração: um vídeo de teste conhecido-bom, um conhecido-fora-de-perfil,
  um corrompido de propósito — cada um exercitando o pipeline completo
  fim a fim contra um Supabase local.

## Sobre a mídia problemática original (regular02)

O arquivo original desta campanha específica já não está mais disponível
para reanálise neste momento (a campanha e sua mídia foram removidas do
Storage/Cloud durante a resposta ao incidente, antes deste projeto de
pipeline existir). **Não é possível afirmar com certeza qual parâmetro
técnico exato causava a trava no `c2.mtk.avc.decoder`** — a hipótese mais
plausível, dado o padrão observado (arquivo de bitrate baixo/tamanho
pequeno para a duração, decodificador MediaTek especificamente afetado),
é um perfil de B-frames ou GOP fora do comum para um encode "amador" ou
gerado por uma ferramenta que não respeitava as convenções de hardware
mobile — mas isso é uma hipótese, não um fato comprovado, e não deve ser
apresentado como diagnóstico definitivo. Se o arquivo aparecer novamente
(nova campanha com o mesmo problema), o pipeline proposto aqui é
exatamente o mecanismo que capturaria e comprovaria a causa técnica real
da próxima vez.
