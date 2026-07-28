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

## Planejado — web

Os módulos seguintes trocarão gradualmente `lib/mock-data.ts` por acesso
tipado em `lib/data`. A UI não embute consultas nem decide autorização.

## Backend e banco

- Supabase Auth possui a extensão de domínio `profiles`; novos usuários começam como `pending`.
- PostgreSQL é a fonte de verdade versionada pelas migrations.
- PostGIS representa posições terrestres como `geography(Point, 4326)`.
- Supabase Storage possui o bucket privado reservado para criativos.
- Edge Functions apenas quando uma fronteira segura de servidor for necessária.
- Migrations versionadas para toda alteração estrutural.
- RLS obrigatória e acesso por least privilege.

O modelo e as políticas estão detalhados em [DATABASE.md](DATABASE.md).

## Planejado — Android offline-first

O tablet sincronizará manifestos e arquivos para armazenamento local antes de reproduzir. Room manterá campanhas, playlist, geofences, regras, configurações, reproduções e telemetria pendente. Media3 tocará somente arquivos locais de campanha. WorkManager fará download e upload resilientes; Coroutines organizarão concorrência e Location Services fornecerá posição.

Sem internet, o player, GPS e geofences continuam operando. Reproduções e eventos ficam pendentes. Quando a conexão retorna, o dispositivo envia eventos, heartbeat e telemetria, verifica novas campanhas e baixa arquivos faltantes de forma idempotente.

## Player e geofencing

O Location Engine avalia elegibilidade localmente. Uma entrada válida não altera o item que já está tocando; ela produz um candidato para a fila prioritária. O Player Engine insere esse candidato depois do item atual, aplica cooldown e deduplicação e, depois da reprodução GEO, retoma a grade regular.

## Sincronização e integridade

Manifestos deverão usar versão e checksum. Uma campanha só fica disponível depois que todos os arquivos obrigatórios forem validados. Downloads incompletos não substituem a versão ativa. Eventos recebem identificadores idempotentes para evitar duplicidade no reenvio.

## Telemetria e observabilidade

Heartbeats futuros incluirão versão do app, bateria, GPS, armazenamento, versão do manifesto e momento da última sincronização. Logs locais terão retenção limitada e serão enviados quando possível. Alertas operacionais usarão janelas de ausência de heartbeat, não uma única falha.

## Segurança

- Nunca expor `service_role` no frontend.
- A chave de serviço opcional existe apenas em módulo `server-only` para
  operações do Supabase Auth Admin.
- Proxy faz renovação/barreira otimista; Server Components, Actions e RLS
  repetem a autorização perto do dado.
- RLS e migrations são requisitos, não opcionais.
- Credenciais de dispositivo serão específicas, rotacionáveis e revogáveis.
- URLs de mídia serão controladas e manifests validados.
- Segredos ficam fora do Git e apenas nos ambientes apropriados.

## Escalabilidade

As fronteiras por app e pacote permitem evoluir painel e dispositivo de forma independente. PostgreSQL e PostGIS sustentam o piloto e a expansão inicial sem microserviços prematuros. Índices, particionamento de eventos e retenção serão introduzidos com evidência de volume.
