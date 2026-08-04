# MAXCAR — Arquitetura

## Visão geral

O sistema será dividido entre cloud e veículo. Na cloud, o painel administrativo usará Supabase para dados, identidade, storage e capacidades geográficas. No veículo, o aplicativo Android manterá mídia, programação, regras e eventos localmente.

## Implementado — MAX-001

- Monorepo npm com painel Next.js, tipos compartilhados e regras de negócio.
- App Router, TypeScript estrito, Tailwind CSS, ESLint e Prettier.
- Interface executiva navegável com dados demonstrativos isolados.
- Regra pura de inserção GEO após o item atual, coberta por testes.
- Simuladores visuais de geofence e player.
- Estrutura reservada para Supabase e aplicativo Android.
- Documentação de produto, arquitetura e decisão técnica.

## Implementado — MAX-002

- Supabase CLI e ambiente local configurado.
- PostgreSQL 17 e PostGIS como fundação de dados.
- Schema inicial versionado em seis migrations.
- Identidades, anunciantes, frota, campanhas, geofences, playlists e eventos.
- RLS baseada em `auth.uid()` e perfis persistidos.
- Idempotência de impressões offline por dispositivo e evento do cliente.
- Bucket privado `campaign-media`, sem políticas de upload prematuras.
- Seed fictício, testes pgTAP e processo de geração de tipos.

Neste marco, o painel ainda permanecia em mocks. Ingestão do dispositivo,
uploads e player Android continuam fora do escopo atual.

## Implementado — MAX-003

- Supabase Auth SSR com cookies e renovação de sessão no `proxy.ts`.
- Layout protegido com autorização derivada de claims validados e `profiles`.
- Estados controlados para contas `pending`, inativas, anunciantes e motoristas.
- AppShell com identidade real, papel, navegação contextual e logout.
- Perfil próprio e gestão administrativa de usuários.
- CRUD real de anunciantes e estabelecimentos em `lib/data`.
- Coordenadas escritas por RPC RLS-aware como `geography(Point, 4326)`.
- Mocks mantidos exclusivamente para módulos fora deste marco.

## Implementado — MAX-004

- CRUD real de campanhas `REGULAR` e `GEO`, com busca e filtros.
- Prontidão de ativação protegida por regras puras e triggers no banco.
- Criativos reais, SHA-256 calculado no servidor e preview com signed URL.
- Bucket `campaign-media` privado, paths por propriedade e RLS de Storage.
- CRUD de geofences ligado à localização PostGIS do estabelecimento.
- Simulador de posição com distância e elegibilidade calculadas por RPC.
- Dashboard alimentado por contagens reais dos módulos já entregues.
- Mocks removidos de campanhas, criativos, geofences e seus indicadores.

Veja [CAMPAIGNS.md](CAMPAIGNS.md) e [STORAGE.md](STORAGE.md).

## Implementado — MAX-005

- CRUD real de motoristas, veículos e dispositivos, isolado em `lib/data` e
  Server Actions validadas.
- Vínculo 1:1 entre motorista e veículo e entre veículo e dispositivo,
  garantido por índices únicos parciais.
- Normalização de códigos e placas brasileiras no app e no PostgreSQL.
- Heartbeats persistidos com bateria, rede, GPS, armazenamento, versão e
  localização PostGIS.
- Estado de conexão derivado por regra pura: online até 5 minutos, atenção até
  15 minutos e offline após esse limite ou sem heartbeat.
- Dashboard e painel de dispositivos alimentados somente por dados reais.
- Simulador local de heartbeat com autorização dupla de `super_admin`.
- Trigger de criação de `profiles` reforçado e coberto por pgTAP.

Veja [FLEET.md](FLEET.md).

## Implementado — MAX-005.5

- Cliente e estabelecimento viraram hubs operacionais: mostram campanhas,
  estabelecimentos e geofences relacionados, com ações rápidas que
  pré-selecionam o vínculo (cliente, tipo de campanha, estabelecimento,
  motorista, veículo).
- Mapa real (Leaflet/OpenStreetMap) no detalhe de estabelecimento e de
  geofence, com marcador próprio para evitar o conflito do ícone padrão do
  Leaflet com as rotas dinâmicas do Next.
- Readiness de campanha (`@maxcar/business-rules`) reutilizada também no
  formulário de edição, não só no detalhe.
- Trigger novo (`profiles_protect_last_super_admin`) impede remover o último
  `super_admin` ativo, com checagem equivalente na Server Action.
- Dashboard reagrupado (Comercial/Frota/Saúde) com métricas clicáveis;
  telemetria fabricada removida do mapa operacional e da topbar.
- Configurações e Relatórios pararam de simular funcionalidade que não
  existe (sem "salvar" fictício, sem números de reprodução inventados).
- Teste E2E (Playwright) cobre login → cliente → estabelecimento → campanha
  GEO → criativo → geofence → ativação → motorista → veículo → dispositivo,
  contra Supabase local, com limpeza automática dos dados criados.

Veja [OPERATIONS_UX.md](OPERATIONS_UX.md).

## Implementado — MAX-006

- Projeto Android nativo (Kotlin + Jetpack Compose) em `apps/android`,
  offline-first desde a fundação: Room, DataStore, WorkManager.
- Identidade do dispositivo (`installation_id`) gerada uma vez no primeiro
  boot e persistida, nunca derivada de `ANDROID_ID` ou outro identificador de
  hardware.
- Ativação por código humano de uso único (15 minutos, hash-only no banco),
  gerado e revogado pelo painel; troca do código por um token de dispositivo
  opaco (256 bits, hash-only), nunca um JWT do Supabase Auth.
- Três Edge Functions (`device-enroll`, `device-heartbeat`, `device-config`)
  são o único caminho do Android até o banco; `service_role` nunca chega ao
  APK.
- Token do dispositivo guardado só em `EncryptedSharedPreferences`
  (Keystore); heartbeats reais e idempotentes substituem o simulador como
  fonte de conexão para dispositivos ativados.
- Falha de rede nunca é tratada como revogação; só uma rejeição explícita do
  servidor limpa a credencial local. Fila de heartbeats pendentes com
  retenção de 7 dias cobre o resto.
- RLS com zero políticas em `device_enrollment_codes` e `device_credentials`
  — todo acesso passa por funções `SECURITY DEFINER` que revalidam papel.

Veja [ANDROID_ARCHITECTURE.md](ANDROID_ARCHITECTURE.md),
[ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md),
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md) e
[DEVICE_SECURITY.md](DEVICE_SECURITY.md).

## Implementado — MAX-007

- Manifesto autenticado (`device-manifest`) retorna a grade REGULAR
  elegível de um dispositivo — específica ou a grade padrão do piloto —
  com URL de download assinada (30 min) por item.
- Download de mídia no Android: streaming fora da main thread, troca
  `.tmp` → validação de tamanho/SHA-256 → renomeação atômica, nunca
  reproduz arquivo parcial. Item com hash inválido nunca fica `READY`.
- Cache local com troca de grade segura: itens obsoletos só são removidos
  depois que a nova grade termina de baixar e validar.
- Player regular (Media3 ExoPlayer para vídeo, Compose para imagem) em
  tela cheia, imersivo, contínuo, sobrevive a ficar sem internet e a
  reiniciar o app/tablet usando só a grade já local.
- Eventos de reprodução (proof-of-play) registrados localmente e
  sincronizados depois, idempotentes por `client_event_id`, reaproveitando
  `impressions` (MAX-002).
- Painel: card "Grade regular do piloto" na campanha (inclui/remove da
  grade padrão, sem SQL) e card "Player" no dispositivo (estado, mídias
  prontas, versão do manifesto, último criativo, último erro).
- GPS, GEO no Android e Device Owner/kiosk real continuam fora do escopo.

Veja [ANDROID_PLAYER.md](ANDROID_PLAYER.md),
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md),
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md) e
[ANDROID_PLAYBACK_EVENTS.md](ANDROID_PLAYBACK_EVENTS.md).

## Planejado — web

Os módulos seguintes trocarão gradualmente `lib/mock-data.ts` por acesso
tipado em `lib/data`. A UI não embute consultas nem decide autorização.

## Backend e banco

- Supabase Auth possui a extensão de domínio `profiles`; novos usuários começam como `pending`.
- PostgreSQL é a fonte de verdade versionada pelas migrations.
- PostGIS representa posições terrestres como `geography(Point, 4326)`.
- Supabase Storage mantém criativos privados com acesso autenticado e assinado.
- Edge Functions apenas quando uma fronteira segura de servidor for necessária.
- Migrations versionadas para toda alteração estrutural.
- RLS obrigatória e acesso por least privilege.

O modelo e as políticas estão detalhados em [DATABASE.md](DATABASE.md).

## Planejado — Android offline-first

O MAX-006 entregou a fundação offline-first (identidade, credencial, Room,
DataStore, WorkManager) e o MAX-007 entregou o player REGULAR completo
sobre ela: o tablet sincroniza o manifesto, baixa e valida os arquivos de
campanha para armazenamento local antes de reproduzir, e Room mantém a
grade (`PlaylistItemEntity`) e a fila de eventos de reprodução
(`PlaybackEventEntity`) — veja
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md) e
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md). O que falta: geofences e
Location Services chegam com o Location Engine em MAX-008, sobre a mesma
base já validada.

Sem internet, o player continua operando com a grade já local. Reproduções
e eventos ficam pendentes. Quando a conexão retorna, o dispositivo envia
eventos, heartbeat e telemetria, verifica novas campanhas e baixa arquivos
faltantes de forma idempotente. GPS e geofences entram nesse mesmo ciclo a
partir do MAX-008.

## Player e geofencing

Implementado (MAX-007): reprodução contínua da grade REGULAR, offline-first,
com troca segura de conteúdo — ver [ANDROID_PLAYER.md](ANDROID_PLAYER.md).

Planejado (MAX-008): o Location Engine avaliará elegibilidade GEO
localmente. Uma entrada válida não altera o item que já está tocando; ela
produz um candidato para a fila prioritária. O Player Engine insere esse
candidato depois do item atual, aplica cooldown e deduplicação e, depois da
reprodução GEO, retoma a grade regular.

## Sincronização e integridade

Implementado (MAX-007): o manifesto usa versão (hash de conteúdo) e
checksum SHA-256 por criativo; um download só vira a versão ativa depois
que tamanho e hash conferem, nunca antes — ver
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md). Eventos de reprodução
recebem `client_event_id` idempotente, mesmo padrão já usado por heartbeats
(MAX-006) e impressões (MAX-002).

## Telemetria e observabilidade

Heartbeats incluem versão do app, bateria, rede, armazenamento e, a partir
do MAX-007, um resumo do estado do player (mídias prontas, versão do
manifesto, criativo atual, último erro) — ver
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md#quando-o-android-sincroniza).
Localização chega com o Location Engine (MAX-008). Logs locais persistentes
e alertas automatizados por ausência de heartbeat continuam planejados.

## Segurança

- Nunca expor `service_role` no frontend.
- A chave de serviço opcional existe apenas em módulo `server-only` para
  operações do Supabase Auth Admin.
- Proxy faz renovação/barreira otimista; Server Components, Actions e RLS
  repetem a autorização perto do dado.
- RLS e migrations são requisitos, não opcionais.
- Credenciais de dispositivo são específicas, hash-only no banco,
  Keystore-backed no Android e revogáveis pelo painel a qualquer momento —
  veja [DEVICE_SECURITY.md](DEVICE_SECURITY.md).
- URLs de mídia são assinadas, curtas (30 min) e nunca persistidas; o
  manifesto só entrega campanhas REGULAR ativas e elegíveis àquele
  dispositivo — ver [ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md).
- Segredos ficam fora do Git e apenas nos ambientes apropriados.

## Escalabilidade

As fronteiras por app e pacote permitem evoluir painel e dispositivo de forma independente. PostgreSQL e PostGIS sustentam o piloto e a expansão inicial sem microserviços prematuros. Índices, particionamento de eventos e retenção serão introduzidos com evidência de volume.
