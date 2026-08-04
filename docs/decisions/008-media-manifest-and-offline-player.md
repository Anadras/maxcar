# ADR 008 — Manifesto de mídia, cache offline e player regular

## Status

Aceito no MAX-007.

## Contexto

O MAX-006 deu ao tablet identidade, credencial e heartbeat, mas nenhum
conteúdo real para mostrar. O piloto precisa do primeiro carro rodando
vinhetas reais o quanto antes, offline-first desde o início — sem depender
de streaming, sem travar se a conexão cair no meio de um trajeto.

## Decisão

**O manifesto é um documento JSON, não uma tabela de linhas.**
`get_device_manifest` retorna um único objeto (cabeçalho + array ordenado),
não um conjunto de linhas — uma grade vazia é um resultado normal e válido,
e um `returns table` não expressaria isso sem gambiarra. `manifestVersion`
é um hash de conteúdo, não um contador; dois manifestos com o mesmo
conteúdo comparam como iguais sem coordenação extra.

**Playlist ganha um vínculo opcional a dispositivo, não uma tabela nova.**
`playlists.device_id` (nullable) diferencia "grade específica deste
tablet" de "grade padrão do piloto" (`device_id is null`) com dois índices
únicos parciais, no mesmo estilo dos vínculos 1:1 já existentes
(motorista↔veículo, veículo↔dispositivo). Evita inventar uma tabela de
associação para um relacionamento que, na prática, é excepcional (a maioria
dos tablets do piloto usa a grade padrão).

**URL assinada nunca é persistida — nem no servidor, nem no Android.** O
manifesto SQL devolve `storagePath`; só a Edge Function, que tem acesso à
API de Storage, assina a URL, com validade de 30 minutos. O Android usa a
URL uma vez, no ciclo de sync em que chegou, e nunca a grava em Room.

**Um item de grade local é uma linha, não quatro.** `PlaylistItemEntity`
funde metadado de playlist, campanha/criativo e estado de download num
único registro Room, chaveado pelo `creativeId`. O manifesto já chega
como uma lista plana e denormalizada; replicar a normalização do servidor
no cliente não teria uso — o único consumidor é o próprio player, que só
precisa saber "isso está pronto, nesta posição, neste arquivo local".

**Evento de reprodução é uma linha finalizada, não um par início/fim.** O
Android só enfileira um evento localmente depois que a reprodução já
terminou (sucesso, erro, ou incompleta por fechamento do app). O servidor
continua com uma única inserção idempotente por evento — a mesma forma do
heartbeat do MAX-006 — em vez de precisar de um update-in-place para
"fechar" um evento aberto.

**Troca de grade é atômica por remoção adiada, não por transação
distribuída.** Novos itens baixam e validam primeiro; os obsoletos só são
removidos depois que todo o manifesto atual foi processado. Não há
coordenação de transação entre Room e o sistema de arquivos — a ordem das
operações já garante que o player nunca vê um estado inconsistente (na
pior hipótese, mistura itens da grade antiga com itens já prontos da nova,
nunca um buraco).

**Vídeo e imagem usam uma única máquina de estados no Android, dois motores
de conteúdo.** Em vez de deixar o Media3 tocar tanto vídeo quanto imagem
(suporte nativo existe, mas é menos maduro e mais dependente de versão),
`PlayerViewModel` decide o avanço para ambos — ExoPlayer só entra para
decodificar/renderizar vídeo. Simplifica testar e raciocinar sobre "o que
está tocando agora" com uma fonte de verdade só.

## Consequências

- Adicionar um vínculo playlist↔veículo (em vez de só
  playlist↔dispositivo) no futuro é uma coluna nova, não uma
  reestruturação — o padrão já está estabelecido.
- Suportar streaming ao vivo ou pré-visualização remota exigiria uma
  arquitetura diferente desta; não é o que este marco resolve, e não foi
  desenhado para acomodar isso sem revisão.
- O limite prático de itens por grade no piloto é pequeno (a implementação
  baixa sequencialmente, sem paralelismo); um catálogo maior exigiria
  revisar `MediaDownloadManager.sync` antes de escalar.
- Kiosk real (Device Owner, Lock Task efetivo) continua fora do escopo —
  ver [ANDROID_PILOT_TABLET_SETUP.md](../architecture/ANDROID_PILOT_TABLET_SETUP.md#device-owner-avaliado-não-ativado).
