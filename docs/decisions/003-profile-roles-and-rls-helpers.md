# ADR-003 — Papéis persistidos e helpers de RLS

- Status: Aceita
- Data: 2026-07-28

## Contexto

Papéis enviados pelo frontend não são confiáveis. Consultar `profiles` dentro das próprias políticas pode causar recursão de RLS.

## Decisão

Novos usuários começam como `pending`. Papéis e vínculos ficam em `profiles`. Helpers mínimos no schema `private` consultam o perfil por `auth.uid()` com `SECURITY DEFINER` e `search_path` vazio. Execução é concedida somente a `authenticated`.

## Consequências

- Usuários não podem promover o próprio papel.
- Políticas derivam identidade do token validado pelo Supabase Auth.
- Funções privilegiadas precisam permanecer pequenas, qualificadas por schema e cobertas por testes.
