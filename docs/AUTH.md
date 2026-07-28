# MAXCAR — Autenticação e usuários

## Configuração

O painel usa `@supabase/ssr` e cookies HTTP para compartilhar a sessão entre
navegador, Server Components, Server Actions e o `proxy.ts` do Next.js 16.

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua-chave-publica
SUPABASE_SERVICE_ROLE_KEY=sua-chave-de-servico-opcional
```

A chave pública pode ser substituída por `NEXT_PUBLIC_SUPABASE_ANON_KEY` em
projetos legados. A chave de serviço é opcional, jamais recebe o prefixo
`NEXT_PUBLIC_` e é importada apenas por um módulo `server-only`.

## Fluxo

1. `/login` autentica e grava a sessão nos cookies.
2. O proxy renova tokens e faz apenas a barreira otimista de sessão.
3. O layout protegido consulta os claims validados e o `profiles` persistido.
4. `pending` segue para `/pending`; contas inativas, anunciantes e motoristas
   seguem para `/acesso-indisponivel`.
5. `super_admin`, `admin`, `commercial` e `operations` recebem o AppShell.
6. Server Actions repetem a autorização e o PostgreSQL aplica RLS.

O menu por papel melhora a experiência, mas não é uma fronteira de segurança.
As políticas derivam a identidade de `auth.uid()` e nunca aceitam um papel
enviado pelo cliente.

## Gestão de usuários

`/usuarios` é acessível somente por administradores. Todo convite cria uma
conta `pending` pelo trigger de `auth.users`. Sem a chave de serviço, perfis
continuam visíveis, mas e-mails e convites ficam desabilitados com aviso
controlado.

Um administrador comum não pode:

- alterar um `super_admin`;
- conceder o papel `super_admin`;
- alterar ou desativar a própria conta.

Somente `super_admin` pode gerir outro `super_admin`. Papéis `advertiser` e
`driver` exigem o respectivo vínculo persistido, conforme a constraint do
banco.

## Operação inicial

O primeiro `super_admin` deve ser promovido por uma operação administrativa
controlada no banco, nunca por uma tela pública. Depois disso, convites e
papéis podem ser geridos no painel. Para desenvolvimento, aplique migrations e
seed com o Supabase local:

```bash
npm run db:start
npm run db:reset
```

Não execute reset em projeto remoto ou vinculado.
