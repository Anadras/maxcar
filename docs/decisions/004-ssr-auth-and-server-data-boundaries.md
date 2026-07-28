# ADR-004 — Auth SSR e fronteiras server-first

- Status: Aceita
- Data: 2026-07-28

## Contexto

O App Router precisa renovar sessões sem expor segredos e impedir que menus ou
parâmetros enviados pelo navegador se tornem autoridade. CRUDs administrativos
também precisam respeitar a mesma identidade que as políticas RLS.

## Decisão

Usar `@supabase/ssr` com cookies, `proxy.ts` somente para renovação e barreira
otimista, e validação completa no layout protegido e em cada Server Action.
Leituras ficam em `lib/data` e usam o cliente da sessão. A chave de serviço é
opcional, `server-only` e restrita ao Auth Admin para e-mails e convites.

Coordenadas de estabelecimentos são enviadas a uma função `SECURITY INVOKER`,
que cria o ponto PostGIS no servidor e mantém RLS como autoridade.

## Consequências

- Ocultar um item do menu nunca substitui autorização.
- Uma sessão válida sem perfil ativo não entra no AppShell.
- Operações administrativas degradam de forma explícita quando a chave de
  serviço não está configurada.
- Novos módulos devem seguir `Server Component → lib/data → Supabase/RLS` e
  `Form → Server Action → validação → Supabase/RLS`.
