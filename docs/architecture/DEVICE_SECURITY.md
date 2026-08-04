# MAXCAR — Segurança da identidade do dispositivo (MAX-006 → MAX-010.6)

O modelo de confiança entre um tablet e o backend. Qualquer mudança nesta
área deve preservar as garantias abaixo; várias delas existem porque foram
regras explícitas e não-negociáveis dos marcos que introduziram e depois
reformularam a identidade do dispositivo. Desde o MAX-010.6, a identidade é
uma chave assimétrica gerada no Android Keystore, não mais um token estático
— para o esquema de assinatura e a arquitetura de verificação em detalhe,
veja [DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md); este documento cobre as
garantias de segurança de mais alto nível que continuam valendo.

## Regra absoluta: `service_role` nunca chega ao Android

`SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_...`) não pode existir em nenhuma
forma dentro do APK — nem em `BuildConfig`, nem em recurso, nem em asset,
nem em código-fonte, nem em log. O Android nunca fala diretamente com o
Postgres nem com a service role; ele fala com as Edge Functions de
dispositivo (`supabase/functions/device-enroll-key-start`,
`device-enroll-key-complete`, `device-recover-key-start`,
`device-recover-key-complete`, `device-heartbeat`, `device-config`,
`device-manifest`, `device-playback-events`, `device-geo-rules`,
`device-geofence-events`, `device-commands`), que são as únicas com
permissão de usar a service role, do lado do servidor.
`data/remote/DeviceApiClient.kt` só conhece `BuildConfig.DEVICE_API_BASE_URL`
(a URL pública das functions) e a própria chave privada do dispositivo, que
nunca deixa o Keystore nem é transmitida — só assinaturas sobre ela.

## O dispositivo nunca escolhe sua identidade

`device_id` é sempre derivado pelo servidor: a Edge Function resolve
`key_id → device_id` via `get_device_key_for_verification` depois de validar
a assinatura, nunca a partir de um valor que o Android tenha enviado no
corpo da requisição. O Android nunca envia um `device_id` que o servidor
deveria confiar. `installation_id` (gerado uma vez no primeiro boot,
`InstallationIdStore`) identifica a instalação de software para fins de
rate-limit e depuração durante o enrollment, mas não é, sozinho, credencial
de nada.

## A chave privada nunca sai do Keystore

`AndroidDeviceKeyStore` (`data/local/DeviceKeyStore.kt`) gera o par de
chaves EC P-256 com `KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,
"AndroidKeyStore")` — a chave privada é `PURPOSE_SIGN`-only, não-exportável
por construção da própria API do Android Keystore, nunca lida em bytes por
nenhum código deste app. Só a chave **pública** (não-secreta) e uma
assinatura por requisição cruzam a rede. Diferente do token estático que
este esquema substitui, perder o registro local do `key_id` não é perda de
identidade — ver "Recuperação" em
[DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md#recuperação-identidade-sem-um-novo-código).

## Nenhum JWT do Supabase Auth para dispositivos

Um tablet nunca recebe um JWT do `auth.users`. A autenticação de dispositivo
é um esquema de assinatura totalmente customizado (v2, por chave) com uma
ponte de compatibilidade para o esquema Bearer anterior (v1, para
dispositivos ainda não atualizados) — os dois validados inteiramente no
servidor, sem sessão, sem refresh token, sem papel (`role`) do Supabase Auth
associado a um tablet. `supabase/config.toml` marca `verify_jwt = false` nas
functions de dispositivo exatamente por isso: o gateway de JWT da
plataforma não se aplica a este esquema.

## Hash-only e chave pública nos dois lados

- **Código de ativação**: só o SHA-256 (`code_hash`) fica em
  `device_enrollment_codes`; o texto puro é devolvido uma única vez pela RPC
  `generate_device_enrollment_code` e nunca mais persistido em lugar nenhum.
- **Chave do dispositivo (v2)**: `device_key_credentials.public_key_der`
  guarda só a chave **pública** (DER) — não há nada de secreto para
  armazenar do lado do servidor; a garantia de segurança vem inteiramente
  de a chave privada nunca ter saído do tablet.
- **Token estático (v1, legado)**: só o SHA-256 (`token_hash`, único) fica
  em `device_credentials`; o valor bruto é devolvido uma única vez por
  `enroll_device` e nunca reaparece em uma consulta subsequente. Mantido
  apenas para dispositivos que ainda não migraram — ver
  [DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md#coexistência-v1v2).

## Nada de header ou corpo sensível em log

`RedactingLoggingInterceptor` (`data/remote/DeviceApiClient.kt`) registra só
método, caminho e status HTTP — nunca os headers `X-Maxcar-*` (que carregam
a assinatura e o `key_id`, nenhum dos dois secreto, mas ainda assim fora de
log por princípio) nem o corpo da requisição/resposta. Do lado do servidor,
`supabase/functions/_shared/device-api.ts#errorResponse` loga só o código do
erro Postgres (`console.error('device api error', error.code)`), nunca a
mensagem completa, que poderia vazar detalhe de schema.

## Falha de rede nunca é revogação

`DeviceRepository.handleUnauthorizedDeviceKey()` só é chamado quando o
servidor responde explicitamente `401` (`DeviceApiError.Unauthorized`) — e
mesmo assim só derruba o pareamento local `key_id`, nunca a chave física
nem o histórico de dispositivo/veículo (ver
[DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md#nunca-apagar-a-chave-automaticamente)).
Timeout, DNS, "sem conexão" — tudo isso vira `DeviceApiError.NetworkUnavailable`,
que enfileira o evento localmente (ver
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md)) e nunca toca a
identidade. Um tablet num veículo sem sinal por horas continua "ativado" até
que o servidor diga o contrário.

## RLS: zero políticas é o padrão

`device_enrollment_codes`, `device_credentials`, `device_key_credentials` e
as tabelas de nonce/sessão/desafio do MAX-010.6 têm RLS habilitada e
**nenhuma política** — nem para `authenticated`, nem para `anon`. Isso nega
todo acesso direto às tabelas, mesmo com `GRANT`, mesmo para um usuário
autenticado do painel. Todo o acesso passa por funções `SECURITY DEFINER`
que revalidam o papel do chamador (`profiles.role`) internamente:

- `generate_device_enrollment_code`, `revoke_device_enrollment_code`,
  `revoke_device_credential`, `revoke_device_key` — exigem
  `super_admin`/`admin`/`operations`, concedidas só a `authenticated`.
- `start_device_key_enrollment`, `complete_device_key_enrollment`,
  `get_device_key_for_verification`, `check_and_record_device_nonce`,
  `mint_device_session_token`, `start_device_key_recovery`,
  `complete_device_key_recovery` — concedidas só a `service_role`, chamadas
  apenas pelas Edge Functions, nunca diretamente pelo painel ou pelo
  tablet.

`device_enrollment_admin_view` e `device_key_admin_view` não usam
`security_invoker`: como as tabelas de base não concedem nada a
`authenticated`, uma view com direitos do invocador veria zero linhas mesmo
para um `admin` legítimo. As views rodam com os direitos do dono e aplicam
sua própria guarda (`where private.current_app_role() in (...)`).

## Rate limiting e abuso

`device_enrollment_attempts` registra toda tentativa de ativação (sucesso ou
falha) por `installation_id`, para os dois esquemas de enrollment (v1 e
v2). `start_device_key_enrollment` recusa novas tentativas (`23514`,
mapeado para HTTP 429) depois de 10 falhas em 15 minutos, mesmo limite do
esquema anterior.

## Expiração e uso único

Um código de ativação expira em 15 minutos e é de uso único
(`device_enrollment_codes.used_at`); gerar um novo código revoga
automaticamente qualquer código pendente anterior para o mesmo dispositivo.
Um índice único parcial garante no máximo uma chave ativa por dispositivo
(`device_key_credentials_one_active_per_device`) — ativar de novo (com um
novo código) revoga a chave anterior antes de ativar a nova. O desafio de
prova de posse (enrollment e recuperação) e o token de sessão de ponte
(~60s, uso único) expiram em janelas curtas pela mesma razão: minimizar por
quanto tempo um valor interceptado continuaria útil.
