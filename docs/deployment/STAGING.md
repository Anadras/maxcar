# MAXCAR — Deploy de staging

## Arquitetura

```
GitHub (Anadras/maxcar, branch main)
  -> Vercel (projeto maxcar-admin)
    -> Next.js 16 (apps/admin)
      -> Supabase Cloud (projeto MAXCAR, sa-east-1)
        Auth, PostgreSQL, PostGIS, Storage, RLS
```

## Vercel

- Projeto: `maxcar-admin`, escopo `anadras-projects`.
- Root Directory: `apps/admin` (monorepo; `sourceFilesOutsideRootDirectory`
  habilitado para que o install rode na raiz e resolva os workspaces
  `@maxcar/shared` e `@maxcar/business-rules` nativamente, sem copiar
  pacotes manualmente).
- Framework: Next.js (auto-detectado). Install/Build/Output command:
  padrão do framework (nenhum override manual).
- Git integration: repositório `Anadras/maxcar` conectado nativamente.
  Push em `main` dispara build + deploy de produção automaticamente;
  Pull Requests recebem Preview Deployments automáticos.
- Domínio atual: `https://maxcar-admin.vercel.app` (produção).
  Domínio customizado ainda não configurado — ver seção "Domínio futuro".

## Ambiente: Production da Vercel = staging operacional

Este é o primeiro deploy estável do painel. Em vez de criar um ambiente
"staging" separado, o deployment de **Production** da Vercel é usado como o
ambiente de staging operacional do MAXCAR, sinalizado por
`NEXT_PUBLIC_APP_ENV=staging`. Isso não é o piloto real com motoristas e
veículos em operação: Android ainda não existe (ver `docs/product/*` e
MAX-006). Quando o piloto real começar, `NEXT_PUBLIC_APP_ENV` muda para
`production` e a distinção fica documentada aqui, não inferida pelo ambiente
da Vercel.

## Environment Variables (nomes apenas — nunca valores)

Configuradas em Vercel, ambientes **Production** e **Preview**:

| Nome                                   | Escopo              | Observação                                                     |
| -------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Production, Preview | pública, usada por browser e SSR                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview | pública (chave publishable/anon)                               |
| `SUPABASE_SERVICE_ROLE_KEY`            | Production, Preview | **server-only**; nunca importada fora de módulos `server-only` |
| `NEXT_PUBLIC_APP_ENV`                  | Production, Preview | `staging` nos dois ambientes                                   |

`SUPABASE_SERVICE_ROLE_KEY` só é usada em `apps/admin/lib/supabase/admin.ts`
(marcado `server-only`) para chamadas administrativas de Auth
(`auth.admin.*`, ex.: convite de usuário). Nenhuma referência
`NEXT_PUBLIC_` aponta para ela; o bundle do cliente não a inclui.

Ambiente **Development** da Vercel não foi populado — desenvolvimento local
usa `apps/admin/.env.local` diretamente (fora do Git).

## Supabase Cloud

- Projeto: MAXCAR, região `sa-east-1` (São Paulo).
- Migrations: todas as 9 migrations locais aplicadas e conferidas com
  `npx supabase db push --dry-run` (`upToDate: true`) após o deploy.
- Auth Site URL: `https://maxcar-admin.vercel.app`.
- Auth Redirect URLs (`uri_allow_list`): URL de produção, um padrão
  `https://maxcar-admin-*-anadras-projects.vercel.app/**` para os Preview
  Deployments deste projeto, e `http://localhost:3000/**` /
  `http://127.0.0.1:3000/**` preservados para desenvolvimento local.
- RLS permanece ativo em todas as tabelas; nenhuma policy foi
  desabilitada para o deploy.

## Como fazer redeploy

Automático: `git push origin main` — a integração GitHub da Vercel builda e
promove automaticamente para produção.

Manual (a partir da raiz do monorepo, com o projeto já linkado):

```bash
npx vercel --prod
```

## Como trocar uma environment variable

```bash
npx vercel env rm NOME_DA_VARIAVEL production
npx vercel env add NOME_DA_VARIAVEL production
# repita para "preview" se necessário, depois:
npx vercel --prod
```

## Rollback

Pela Vercel (dashboard ou CLI), promova um deployment anterior de volta a
produção — não é um sistema customizado:

```bash
npx vercel rollback [url-ou-id-do-deployment-anterior]
```

Ou, no dashboard do projeto, aba **Deployments**, escolha um deployment
`Ready` anterior e use **Promote to Production**.

## Logs

```bash
npx vercel logs https://maxcar-admin.vercel.app
npx vercel inspect <deployment-url> --logs   # logs de build de um deployment específico
```

## Domínio futuro

Este marco usa apenas o domínio `*.vercel.app`. Não há DNS externo
configurado. Quando um domínio próprio for definido, os passos serão:

1. `npx vercel domains add <dominio>` no projeto `maxcar-admin`;
2. configurar o DNS (CNAME/A) conforme instrução da Vercel;
3. atualizar `NEXT_PUBLIC_APP_ENV` e o Site URL/Redirect URLs do Supabase
   Auth para o novo domínio;
4. decidir se o domínio customizado aponta para o ambiente de staging atual
   ou para um ambiente de produção separado do piloto real (ver seção
   acima sobre Production = staging operacional).

## Diferença entre este staging e a produção futura

Este deploy expõe o painel administrativo real, conectado ao Supabase Cloud
real, mas **sem** o aplicativo Android, sem tablets físicos em operação e
sem motoristas/veículos reais cadastrados — o banco de dados de frota e
campanhas está vazio, pronto para receber dados de teste prefixados com
`TESTE -`. A produção futura (pós MAX-006 em diante) envolve dispositivos
Android reais, identidade/autenticação própria do tablet, heartbeats reais
e dados de clientes/campanhas reais em operação comercial.
