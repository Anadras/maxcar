# MAXCAR

MAXCAR é uma plataforma de mídia digital para tablets Android instalados em veículos de motoristas de aplicativo. Este repositório contém a fundação técnica do produto e um painel executivo navegável para demonstrar a operação, as campanhas e o diferencial de ativações geolocalizadas.

## Estado atual

O MAX-002 adiciona a arquitetura real de dados: Supabase local, PostgreSQL, PostGIS, migrations, seed fictício, RLS, testes pgTAP e contratos TypeScript. O painel do MAX-001 continua usando mocks; autenticação e CRUDs reais pertencem ao próximo marco.

## Stack

- Monorepo com npm workspaces
- Next.js 16, React 19 e App Router
- TypeScript em modo `strict`
- Tailwind CSS 4 e design tokens CSS
- ESLint e Prettier
- Vitest para regras críticas de negócio
- Supabase CLI, PostgreSQL 17, PostGIS, Auth, Storage e pgTAP
- Android nativo em Kotlin planejado para o player embarcado

## Estrutura

```text
maxcar/
├── apps/
│   ├── admin/                 # painel executivo Next.js
│   └── android/               # documentação do futuro app nativo
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

Abra `http://localhost:3000`.

## Comandos

```bash
npm run dev          # ambiente de desenvolvimento
npm run build        # build de produção
npm run lint         # análise estática
npm run typecheck    # validação TypeScript
npm run test         # testes das regras de negócio
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

Copie `.env.example` apenas quando uma integração futura exigir variáveis locais. Nenhuma variável é necessária para o painel demonstrativo. Nunca use uma chave `service_role` no frontend ou em arquivo versionado.

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

## Organização do código

- `apps/admin/app`: rotas e composição das páginas.
- `apps/admin/components`: shell, primitives visuais e simuladores.
- `apps/admin/lib/mock-data.ts`: única fonte de dados demonstrativos.
- `packages/business-rules`: lógica independente de UI, incluindo a inserção GEO após a mídia atual.
- `packages/shared`: contratos tipados compartilhados.
- `supabase/migrations`: fonte de verdade versionada do schema e da segurança.
- `supabase/seed/development.sql`: dados exclusivamente fictícios para desenvolvimento.
- `supabase/tests`: testes pgTAP de schema, geografia, constraints e RLS.

Consulte [produto](docs/product/PRODUCT.md), [arquitetura](docs/architecture/ARCHITECTURE.md), [banco de dados](docs/architecture/DATABASE.md) e os ADRs em `docs/decisions`.
