# MAXCAR — Segurança da identidade do dispositivo (MAX-006)

O modelo de confiança entre um tablet e o backend. Qualquer mudança nesta
área deve preservar as garantias abaixo; várias delas existem porque foram
regras explícitas e não-negociáveis do marco que introduziu a identidade do
dispositivo.

## Regra absoluta: `service_role` nunca chega ao Android

`SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_...`) não pode existir em nenhuma
forma dentro do APK — nem em `BuildConfig`, nem em recurso, nem em asset,
nem em código-fonte, nem em log. O Android nunca fala diretamente com o
Postgres nem com a service role; ele fala com três Edge Functions
(`supabase/functions/device-enroll`, `device-heartbeat`, `device-config`),
que são as únicas com permissão de usar a service role, do lado do servidor.
`data/remote/DeviceApiClient.kt` só conhece `BuildConfig.DEVICE_API_BASE_URL`
(a URL pública das functions) e o token opaco do próprio dispositivo.

## O dispositivo nunca escolhe sua identidade

`device_id` é sempre derivado pelo servidor a partir do hash do token
recebido (`private.device_id_for_token` em
`supabase/migrations/20260730090100_device_api_surface.sql`). O Android
nunca envia um `device_id` que o servidor deveria confiar — cada chamada
autenticada (heartbeat, config) manda só o `Authorization: Bearer <token>`,
e é a partir daí que o backend descobre de qual dispositivo se trata.
`installation_id` (gerado uma vez no primeiro boot, `InstallationIdStore`)
identifica a instalação de software para fins de rate-limit e depuração, mas
não é, sozinho, credencial de nada.

## Nenhum JWT do Supabase Auth para dispositivos

Um tablet nunca recebe um JWT do `auth.users`. A autenticação de dispositivo
é um esquema `Authorization: Bearer` totalmente customizado, validado
inteiramente no servidor por busca de hash — não há sessão, não há refresh
token, não há papel (`role`) do Supabase Auth associado a um tablet.
`supabase/config.toml` marca `verify_jwt = false` nas três functions de
dispositivo exatamente por isso: o gateway de JWT da plataforma não se aplica
a este esquema.

## Hash-only nos dois lados

- **Código de ativação**: só o SHA-256 (`code_hash`) fica em
  `device_enrollment_codes`; o texto puro é devolvido uma única vez pela RPC
  `generate_device_enrollment_code` e nunca mais persistido em lugar nenhum.
- **Token do dispositivo**: só o SHA-256 (`token_hash`, único) fica em
  `device_credentials`; o valor bruto (256 bits, `gen_random_bytes(32)`) é
  devolvido uma única vez por `enroll_device` na resposta HTTP e nunca
  reaparece em uma consulta subsequente.
- **No Android**: o token bruto vive exclusivamente em
  `SecureTokenStore` (`data/local/SecureTokenStore.kt`) —
  `EncryptedSharedPreferences` com chave gerada e mantida no Android
  Keystore (`AES256-GCM`). Nunca em `SharedPreferences` puro, Room, DataStore
  ou log. Perder esse valor (reset de fábrica, desinstalação) significa
  reativação obrigatória com um novo código — por design, o mesmo raciocínio
  do lado servidor, que também não guarda o valor recuperável.

## Nada de header ou corpo sensível em log

`RedactingLoggingInterceptor` (`data/remote/DeviceApiClient.kt`) registra só
método, caminho e status HTTP — nunca o header `Authorization` nem o corpo
da requisição/resposta. Do lado do servidor,
`supabase/functions/_shared/device-api.ts#errorResponse` loga só o código do
erro Postgres (`console.error('device api error', error.code)`), nunca a
mensagem completa, que poderia vazar detalhe de schema.

## Falha de rede nunca é revogação

`DeviceRepository.handleRevocation()` só é chamado quando o servidor
responde explicitamente `401` (`DeviceApiError.Unauthorized`). Timeout, DNS,
"sem conexão" — tudo isso vira `DeviceApiError.NetworkUnavailable`, que
enfileira o evento localmente (ver
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md)) e nunca limpa a
credencial. Um tablet num veículo sem sinal por horas continua "ativado" até
que o servidor diga o contrário.

## RLS: zero políticas é o padrão

`device_enrollment_codes` e `device_credentials` têm RLS habilitada e
**nenhuma política** — nem para `authenticated`, nem para `anon`. Isso nega
todo acesso direto às tabelas, mesmo com `GRANT`, mesmo para um usuário
autenticado do painel. Todo o acesso passa por funções `SECURITY DEFINER`
que revalidam o papel do chamador (`profiles.role`) internamente:

- `generate_device_enrollment_code`, `revoke_device_enrollment_code`,
  `revoke_device_credential` — exigem `super_admin`/`admin`/`operations`,
  concedidas só a `authenticated`.
- `enroll_device`, `record_device_enrollment_attempt` — concedidas só a
  `service_role`, chamadas apenas pelas Edge Functions.

`device_enrollment_admin_view` não usa `security_invoker`: como as tabelas
de base não concedem nada a `authenticated`, uma view com direitos do
invocador veria zero linhas mesmo para um `admin` legítimo. A view roda com
os direitos do dono e aplica sua própria guarda
(`where private.current_app_role() in (...)`).

## Rate limiting e abuso

`device_enrollment_attempts` registra toda tentativa de ativação (sucesso ou
falha) por `installation_id`. `enroll_device` recusa novas tentativas
(`23514`, mapeado para HTTP 429) depois de 10 falhas em 15 minutos. O
registro da tentativa acontece numa chamada separada
(`record_device_enrollment_attempt`) porque um `RAISE EXCEPTION` dentro de
`enroll_device` desfaria qualquer `INSERT` feito antes no mesmo `enroll_device`
— sem essa separação, tentativas malsucedidas nunca seriam contabilizadas.

## Expiração e uso único

Um código de ativação expira em 15 minutos e é de uso único
(`device_enrollment_codes.used_at`); gerar um novo código revoga
automaticamente qualquer código pendente anterior para o mesmo dispositivo.
Um índice único parcial garante no máximo uma credencial ativa por
dispositivo — ativar de novo (com um novo código) revoga a credencial
anterior antes de emitir a nova.
