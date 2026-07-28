# MAXCAR

MAXCAR é uma plataforma de mídia digital para tablets Android instalados em veículos de motoristas de aplicativo. Este repositório contém a fundação técnica do produto e um painel executivo navegável para demonstrar a operação, as campanhas e o diferencial de ativações geolocalizadas.

## Estado atual

O MAX-001 entrega o painel administrativo em Next.js com dados demonstrativos, regras de fila GEO testadas e documentação da arquitetura planejada. Backend, autenticação, banco, mapas reais e aplicativo Android são marcos futuros e não são simulados como integrações reais.

## Stack

- Monorepo com npm workspaces
- Next.js 16, React 19 e App Router
- TypeScript em modo `strict`
- Tailwind CSS 4 e design tokens CSS
- ESLint e Prettier
- Vitest para regras críticas de negócio
- Supabase planejado para backend, PostgreSQL, PostGIS, Auth e Storage
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
```

## Ambiente

Copie `.env.example` apenas quando uma integração futura exigir variáveis locais. Nenhuma variável é necessária para o MAX-001. Nunca use uma chave `service_role` no frontend ou em arquivo versionado.

## Organização do código

- `apps/admin/app`: rotas e composição das páginas.
- `apps/admin/components`: shell, primitives visuais e simuladores.
- `apps/admin/lib/mock-data.ts`: única fonte de dados demonstrativos.
- `packages/business-rules`: lógica independente de UI, incluindo a inserção GEO após a mídia atual.
- `packages/shared`: contratos tipados compartilhados.

Consulte [produto](docs/product/PRODUCT.md), [arquitetura](docs/architecture/ARCHITECTURE.md) e [ADR-001](docs/decisions/001-monorepo-and-boundaries.md).
