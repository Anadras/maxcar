# MAXCAR — Cache offline de mídia (MAX-007)

O que acontece entre "o manifesto diz que existe este item" e "o player
pode reproduzi-lo". Toda a lógica vive em
`data/repository/MediaDownloadManager.kt`; nenhuma outra classe escreve
estado de download.

## Armazenamento

`context.filesDir/media/` — diretório interno do app, sem depender de
cartão SD nem de permissão de armazenamento (não é preciso pedir
`WRITE_EXTERNAL_STORAGE`: `filesDir` é privado ao app por padrão). Cada
arquivo final é nomeado `<creativeId>.<extensão>`, extensão derivada do
`mimeType` do manifesto.

## O estado de cada item

`PlaylistItemEntity` (Room) funde num único registro por criativo tanto os
metadados da grade (posição, duração, tipo) quanto o próprio estado de
download — a grade já chega do servidor como uma lista plana por posição
(ver [ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md)), então uma única
tabela local espelha isso diretamente em vez de normalizar em
campanha/criativo/item-de-playlist/download como entidades separadas que o
app não teria outro uso para elas.

Estados (`PlaylistItemEntity.STATUS_*`): `PENDING`, `DOWNLOADING`, `READY`,
`FAILED`, `OBSOLETE` (reservado; hoje um item obsoleto é removido
diretamente, não marcado). **O player só lê `READY`**
(`PlaylistItemDao.observeReady()`) — nunca um arquivo parcial ou
não-validado.

## O que dispara um download

A cada `sync()`, cada item do manifesto é comparado ao que já existe
localmente:

- Já `READY`, mesmo `sha256`, arquivo ainda presente em disco → **mantido
  como está**, sem re-download. É essa checagem (`?.takeIf { ... }` em
  `MediaDownloadManager.sync`) que torna uma sincronização repetida do
  mesmo manifesto praticamente gratuita.
- Qualquer outra situação (novo criativo, hash mudou, arquivo sumiu do
  disco, download anterior tinha falhado) → vira `PENDING` e é baixado
  nesta mesma passada.

## Download atômico

```
<creativeId>.tmp
  → download completo (streaming, nunca todo o arquivo em memória)
  → tamanho confere com fileSizeBytes (quando informado)
  → SHA-256 confere com o do manifesto (quando informado)
  → renomeia para <creativeId>.<extensão>
  → status = READY
```

Falha em qualquer etapa (tamanho, hash, rename): o `.tmp` é apagado, o item
fica `FAILED` com uma razão curta e segura em `lastError` (nunca um stack
trace ou a URL assinada), e a grade anterior daquele item — se havia uma —
continua intacta. Um item `FAILED` é tentado de novo automaticamente na
próxima sincronização, sem esperar intervenção.

Download em si (`DeviceApiClient.downloadTo`) roda em `Dispatchers.IO`,
sempre fora da main thread, e copia o corpo da resposta direto para o
arquivo de destino (`byteStream().copyTo(output)`) — nunca carrega um vídeo
inteiro em memória primeiro.

## Troca segura da grade (atomic swap)

```
grade atual continua servindo o player
  → itens da nova grade baixam e validam, um a um
  → só então os itens que não estão mais no manifesto são removidos
    (arquivo + linha no Room)
```

A grade antiga nunca é apagada antes da nova estar pronta: durante uma
ressincronização, o player continua enxergando os itens antigos (ainda
`READY`) somados aos novos que já terminaram de baixar, sem lacuna. A
remoção dos itens obsoletos só acontece depois que todo item do manifesto
atual foi processado (`READY` ou `FAILED` definitivo) —
`PlaylistItemDao.deleteNotIn`, chamado uma única vez ao final de `sync()`.

## Limite de armazenamento

Antes de cada download, `MediaDownloadManager` verifica o espaço livre via
`StatFs` no diretório de mídia. Menos de **1 GB** livre após o download
previsto → o item fica `FAILED` com `lastError = "insufficient_storage"`,
sem tentar o download. O limite é uma constante única
(`MediaDownloadManager.MIN_FREE_BYTES`), documentada aqui, não hardcoded em
mais de um lugar. Não há transcodificação nem redução de qualidade
automática — se o piloto crescer a ponto de esbarrar nesse limite com
frequência, o ajuste é aumentar a margem ou revisar o tamanho recomendado
dos criativos (ver limites abaixo).

## Formatos suportados

- **Vídeo**: MP4/H.264 é o padrão recomendado; WebM é aceito se já
  cadastrado e o Media3 do aparelho suportar, mas não é o formato indicado
  para novos clientes.
- **Imagem**: JPEG, PNG, WebP.

Mesma lista de `storage.buckets.campaign-media.allowed_mime_types`
(`supabase/config.toml`) e do MIME derivado da extensão no servidor
(`private.creative_mime_type`, migration MAX-007) — um único conjunto de
formatos válidos, não uma lista solta no Android.

## Recomendação de criativo para o piloto

- Resolução compatível com a tela do tablet (Black Shark, 11", landscape).
- Duração de 10 a 30 segundos.
- Bitrate moderado (o limite de upload no painel já é 50 MB por criativo).
- MP4/H.264, sem depender de áudio — o player roda mudo por padrão (ver
  [ANDROID_PLAYER.md](ANDROID_PLAYER.md) e a decisão de áudio abaixo).

## Áudio

`PlayerViewModel` inicializa o ExoPlayer com `volume = 0f` — mudo por
padrão. Publicidade dentro de um veículo particular não deve presumir que
o passageiro quer som. Configuração remota de volume (via `RemoteConfig`)
fica para um marco futuro; a decisão de partir mudo é deliberada, não uma
lacuna.
