# MAXCAR

MAXCAR é uma plataforma de mídia digital para tablets Android instalados em veículos de motoristas de aplicativo. Este repositório contém a fundação técnica do produto e um painel executivo navegável para demonstrar a operação, as campanhas e o diferencial de ativações geolocalizadas.

## Estado atual

O MAX-005 conecta motoristas, veículos, dispositivos e heartbeats ao Supabase.
O MAX-005.5 conecta essas áreas entre si: cliente e estabelecimento viraram
hubs operacionais, a frota é navegável em qualquer direção
(motorista ↔ veículo ↔ dispositivo), a prontidão de campanha é visível antes
da ativação e o monitoramento mostra o que precisa de atenção agora. O painel
possui CRUDs reais, vínculos 1:1 protegidos no PostgreSQL, saúde operacional
derivada do último sinal e dashboard de frota real.

O MAX-006 entrega o primeiro código real do tablet: um app Android nativo
(Kotlin/Compose) em `apps/android`, com identidade própria, ativação por
código de uso único gerado no painel, credencial hash-only Keystore-backed e
heartbeat autenticado offline-first (Room + WorkManager). Player, mídia,
GEO e localização em segundo plano permanecem fora deste marco.

## Stack

- Monorepo com npm workspaces
- Next.js 16, React 19 e App Router
- TypeScript em modo `strict`
- Tailwind CSS 4 e design tokens CSS
- ESLint e Prettier
- Vitest para regras críticas de negócio
- Supabase CLI, PostgreSQL 17, PostGIS, Auth, Storage, Edge Functions e pgTAP
- Android nativo em Kotlin + Jetpack Compose, offline-first (Room,
  WorkManager, DataStore)

## Estrutura

```text
maxcar/
├── apps/
│   ├── admin/                 # painel executivo Next.js
│   └── android/               # app nativo do tablet (Kotlin/Compose)
├── packages/
│   ├── shared/                # tipos compartilhados
│   └── business-rules/        # regras puras e testes da fila
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── seed/
├── docs/
│   ├── architecture/
│   ├── product/
│   └── decisions/
├── scripts/
└── tests/
```

## Requisitos

- Node.js 22 ou superior
- npm 10 ou superior
- Docker Desktop ou runtime Docker compatível para o Supabase local

## Instalação e execução

```bash
npm install
npm run dev
```

Copie `.env.example` para `.env.local`, configure um projeto Supabase com as
migrations aplicadas e abra `http://localhost:3000`.

## Comandos

```bash
npm run dev          # ambiente de desenvolvimento
npm run build        # build de produção
npm run lint         # análise estática
npm run typecheck    # validação TypeScript
npm run test         # testes da aplicação e das regras de negócio
npm run test:e2e     # fluxo operacional ponta a ponta (Playwright, Supabase local)
npm run format:check # validação de formatação
npm run db:start     # inicia o Supabase local
npm run db:reset     # recria banco, aplica migrations e seed
npm run db:check     # valida invariantes das migrations sem Docker
npm run db:lint      # valida funções e schema local
npm run db:test      # executa testes pgTAP
npm run db:types     # gera tipos do schema em packages/shared
npm run db:stop      # encerra o Supabase local
```

## Ambiente

`NEXT_PUBLIC_SUPABASE_URL` e uma chave pública (`PUBLISHABLE_KEY`, ou
`ANON_KEY` em projetos legados) são obrigatórias. `SUPABASE_SERVICE_ROLE_KEY`
é opcional e habilita somente no servidor a listagem de e-mails e o envio de
convites. Nunca use essa chave em uma variável `NEXT_PUBLIC_*`, no navegador ou
em arquivo versionado. Veja [AUTH.md](docs/AUTH.md).

## Banco local

Com Docker ativo:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
```

O reset atua exclusivamente no projeto Supabase local configurado em `supabase/config.toml`. Não use `db reset` contra projetos vinculados ou ambientes remotos.
Os tipos gerados ficam em `packages/shared/src/database.types.ts` e podem ser importados por `@maxcar/shared/database-types`. A geração é atômica: uma falha da CLI não sobrescreve tipos válidos.

## Aplicativo Android

`apps/android` é um projeto Gradle independente (não faz parte dos npm
workspaces). Requer JDK 17+ e o Android SDK (`local.properties` com
`sdk.dir`, não versionado):

```bash
cd apps/android
./gradlew :app:assembleStagingDebug        # gera o APK de staging/debug
./gradlew :app:testStagingDebugUnitTest    # testes unitários (JVM/Robolectric)
./gradlew :app:lintStagingDebug            # análise estática
```

Veja [arquitetura Android](docs/architecture/ANDROID_ARCHITECTURE.md).

## Organização do código

- `apps/admin/app`: rotas e composição das páginas.
- `apps/admin/components`: shell, primitives visuais e simuladores.
- `apps/admin/lib/data`: acesso tipado a dados reais, isolado da UI.
- `apps/admin/lib/mock-data.ts`: dados demonstrativos apenas do player e de relatórios ainda não migrados.
- `packages/business-rules`: regras puras de campanhas, fila GEO e saúde de dispositivos.
- `packages/shared`: contratos tipados compartilhados.
- `supabase/migrations`: fonte de verdade versionada do schema e da segurança.
- `supabase/seed/development.sql`: dados exclusivamente fictícios para desenvolvimento.
- `supabase/tests`: testes pgTAP de schema, geografia, constraints e RLS.

Consulte [autenticação](docs/AUTH.md), [produto](docs/product/PRODUCT.md),
[arquitetura](docs/architecture/ARCHITECTURE.md),
[campanhas](docs/architecture/CAMPAIGNS.md),
[frota e monitoramento](docs/architecture/FLEET.md),
[monitoramento de dispositivos](docs/architecture/DEVICE_MONITORING.md),
[fluxo operacional e UX](docs/architecture/OPERATIONS_UX.md),
[Storage](docs/architecture/STORAGE.md),
[banco de dados](docs/architecture/DATABASE.md),
[arquitetura Android](docs/architecture/ANDROID_ARCHITECTURE.md),
[ativação do tablet](docs/architecture/ANDROID_ENROLLMENT.md),
[offline-first Android](docs/architecture/ANDROID_OFFLINE_FIRST.md),
[segurança do dispositivo](docs/architecture/DEVICE_SECURITY.md),
[deploy de staging](docs/deployment/STAGING.md) e os ADRs em
`docs/decisions`.
