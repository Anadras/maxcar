# ADR-001 — Monorepo e fronteiras de responsabilidade

- Status: Aceita
- Data: 2026-07-28

## Contexto

MAXCAR terá painel web, aplicativo Android, contratos compartilhados, regras críticas, infraestrutura Supabase e documentação. MAX-001 precisa permanecer simples, mas não pode enterrar a regra GEO na interface.

## Decisão

Usar npm workspaces com `apps/admin`, `apps/android`, `packages/shared` e `packages/business-rules`. O painel é uma aplicação Next.js. Tipos de domínio ficam em `shared`; regras puras de fila ficam em `business-rules`; mocks ficam na aplicação e serão substituídos por acesso tipado ao Supabase.

## Consequências

- A regra GEO pode ser testada sem React ou backend.
- O painel e o futuro Android mantêm fronteiras claras.
- O monorepo usa uma única instalação JavaScript.
- Não há ferramenta de orquestração adicional nesta fase; npm workspaces é suficiente.
