# MAXCAR — Autenticação do tablet por chave criptográfica (MAX-010.6)

Como o tablet deixou de se autenticar com um token estático (`Authorization:
Bearer <token>`, MAX-006/[DEVICE_SECURITY.md](DEVICE_SECURITY.md) na sua
forma anterior) e passou a assinar cada requisição com uma chave EC P-256
que nunca sai do Android Keystore. Para o fluxo de ativação em si (o que o
operador vê no painel, o que o tablet mostra na tela), veja
[ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md); este documento cobre o
esquema criptográfico e a arquitetura de verificação no servidor.

## Por que trocar o token por uma chave

Correções sucessivas na camada de armazenamento do token (Room em vez de
`EncryptedSharedPreferences`, `journal_mode=TRUNCATE`, desativar o
`com.mediatek.duraspeed`, corrigir um bug real de migração repetida — ver o
histórico em [ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md#max-011-instabilidade-de-armazenamento-não-resolvida-num-tablet-físico))
não resolveram um desaparecimento intermitente do token num tablet físico
do piloto. Em vez de continuar investigando o armazenamento em si, o marco
MAX-010.6 elimina a dependência: a identidade do dispositivo passa a viver
numa chave assimétrica gerada e mantida inteiramente dentro do Android
Keystore, nunca extraída, nunca serializada, nunca gravada em Room/
DataStore/SharedPreferences — não há mais "o token que precisa sobreviver
num arquivo". O que precisa sobreviver localmente depois disso é só o
`key_id`, um identificador não-secreto — e mesmo perdendo esse identificador
local, a identidade é recuperável (ver "Recuperação" abaixo) sem precisar de
um novo código de ativação.

## Esquema de assinatura

- **Algoritmo**: ECDSA P-256/SHA-256. O que trafega e o que o servidor
  verifica é sempre o formato raw IEEE P1363 (`r‖s`, 64 bytes) — o Web
  Crypto do Deno (`crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
  …)`) só entende esse formato, nunca ASN.1 DER. **Como o Android produz
  esse formato é diferente do que este projeto assumiu originalmente**:
  `SHA256withECDSAinP1363Format` — o nome de algoritmo que este projeto
  esperava que o Android suportasse nativamente — não existe em nenhum
  provider de segurança real do Android (confirmado por teste instrumentado
  em hardware físico, Android 15/API 35: `AndroidKeyStore`,
  `AndroidKeyStoreBCWorkaround` e `AndroidOpenSSL` recusam esse nome). Ele só
  funcionava nos testes deste projeto porque a JVM de desktop (provider
  SunEC do OpenJDK) registra esse nome — nenhum teste unitário/Robolectric
  seria capaz de detectar essa diferença, só um teste físico. O Android
  assina com o algoritmo padrão e universalmente suportado
  (`Signature.getInstance("SHA256withECDSA")`, formato DER —
  `SEQUENCE { INTEGER r, INTEGER s }`) e converte para raw em Kotlin puro
  (`data/local/EcdsaSignatureFormat.kt`) antes de transmitir. O servidor
  nunca muda: ele sempre esperou e só entende o formato raw.
- **Chave pública**: X.509 SubjectPublicKeyInfo DER, base64 no transporte —
  exatamente o que `KeyPair.public.encoded` produz para uma chave EC do
  Keystore e exatamente o que `crypto.subtle.importKey('spki', …)` espera.
- **Requisição canônica** (bytes UTF-8, unidos por `\n`, exatamente estas 6
  linhas):

  ```text
  MAXCAR1
  <METHOD>
  <PATH>            nome da function só, ex. "/device-heartbeat" — nunca a
                     URL completa com hostname do projeto
  <TIMESTAMP>       ISO-8601, ex. 2026-08-04T19:00:00.000Z
  <NONCE>
  <BODY_SHA256>     hex minúsculo, SHA-256 dos bytes crus do corpo
                     (sha256("") para um corpo vazio, ex. toda requisição GET)
  ```

  Implementado em `DeviceRequestSigner` (Android,
  `data/remote/DeviceRequestSigner.kt`) e
  `supabase/functions/_shared/device-signature.ts` (servidor) — os dois
  precisam produzir bytes idênticos; qualquer mudança num lado sem o outro
  quebra toda assinatura.

- **Headers HTTP**: `X-Maxcar-Key-Id`, `X-Maxcar-Timestamp`,
  `X-Maxcar-Nonce`, `X-Maxcar-Body-SHA256`, `X-Maxcar-Signature` (base64),
  `X-Maxcar-Signature-Version` (`MAXCAR1`).
- **Janela de tolerância de relógio**: 5 minutos
  (`TIMESTAMP_TOLERANCE_MS`); fora disso o servidor responde
  `{error: "clock_skew"}` com HTTP 401.
- **Replay**: cada `(key_id, nonce)` só pode ser usado uma vez
  (`private.device_key_request_nonces`, chave primária composta,
  `check_and_record_device_nonce` faz um `insert` atômico e converte
  `unique_violation` em `false`).

## Arquitetura de verificação: a "ponte" para os RPCs existentes

O Postgres não tem verificação ECDSA nativa, então quem verifica a
assinatura é a Edge Function (`supabase/functions/_shared/device-signature.ts
#verifySignedDeviceRequest`), não o banco. Em vez de ensinar cada um dos 7+
RPCs existentes (`record_device_heartbeat`, `get_device_manifest`, etc.) a
entender ECDSA, a Edge Function, depois de verificar a assinatura, chama
`mint_device_session_token(key_id)` — que gera um token opaco de uso único
com validade de ~60 segundos, na **mesma forma/hashing** dos tokens
estáticos do v1 — e passa esse token para o RPC de sempre, sem nenhuma
mudança no corpo desses RPCs. `private.device_id_for_token` (o único ponto
que todo RPC v1 já chamava) foi estendido para também reconhecer esses
tokens de sessão v2, então a mudança fica inteiramente aditiva: zero RPCs
existentes tiveram o corpo alterado, só essa função de resolução de
identidade.

```text
Android                    Edge Function                     Postgres
  │  assina requisição          │                                │
  ├─────────────────────────────▶ verifySignedDeviceRequest       │
  │                              ├── get_device_key_for_verification
  │                              ├── verifica assinatura (Web Crypto)
  │                              ├── check_and_record_device_nonce │
  │                              ├── mint_device_session_token ────▶
  │                              │◀──────── session_token (~60s) ──┤
  │                              ├── record_device_heartbeat(token) ▶ (RPC v1, inalterado)
  │◀───────────── resposta ──────┤                                │
```

## Enrollment: prova de posse por desafio-resposta

`device-enroll-key-start` recebe a chave pública + `installation_id` +
código de ativação (o mesmo código humano-digitável de sempre — ver
[ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md)), valida o código **sem
consumi-lo**, e devolve um desafio aleatório de 32 bytes. O tablet assina
esse desafio com a chave recém-gerada e chama `device-enroll-key-complete`;
só então (com a assinatura já verificada pela Edge Function) o código é
consumido, qualquer credencial v1/v2 anterior é revogada, e a nova chave é
ativada — tudo numa única transação, idempotente numa repetição (uma
segunda chamada com o mesmo `enrollmentAttemptId` já concluído devolve o
mesmo resultado em vez de erro).

## Recuperação: identidade sem um novo código

Como a chave pública/fingerprint pode sempre ser recalculada a partir do
Keystore (não depende de nenhum estado salvo pelo app), um tablet que perdeu
só o **registro local** de `device_id`/`key_id` — Room resetado, linha
perdida, um `adb install -r` que mudou o schema — recupera sozinho:
`start_device_key_recovery(fingerprint)` devolve um novo desafio, o tablet
assina, `complete_device_key_recovery` confirma a posse e devolve os mesmos
identificadores de sempre. Nunca cria nem muda credencial nenhuma — só
confirma uma identidade que já estava ativa. Um fingerprint desconhecido ou
de uma chave já revogada recebe a mesma mensagem genérica
("Unknown or revoked device key") nos dois casos, para nunca confirmar nem
negar a um chamador não autenticado se aquele fingerprint específico
pertence a um dispositivo real.

No Android, `DeviceRepository.resolveKeyId` tenta esse caminho
automaticamente sempre que existe uma chave no Keystore mas nenhum
`key_id` local pareado — nunca como reação a um erro específico do
servidor, só como parte do fluxo normal de resolver qual identidade usar
antes de cada chamada. Ver a seção "Nunca apagar a chave automaticamente"
abaixo.

## Nunca apagar a chave automaticamente

Nenhum caminho de sincronização chama `DeviceKeyStore.deleteKey()`. Uma
resposta `401` do servidor (chave desconhecida, revogada ou assinatura
inválida) só derruba o **pareamento local** (`DeviceStateEntity.keyId =
null`, via `DeviceRepository.handleUnauthorizedDeviceKey`) — nunca a chave
física no Keystore, nunca o histórico de dispositivo/veículo. O próximo
ciclo tenta recuperar a identidade automaticamente (seção anterior); se a
chave realmente foi revogada, a recuperação falha do mesmo jeito controlado
que qualquer fingerprint desconhecido, e o app mostra o mesmo aviso
"credencial ausente localmente" que já existia para outras falhas de
identidade — nunca uma volta automática e silenciosa para a tela de
ativação. `deleteKey()` só existe para uma futura ação explícita e
operador-iniciada (ex. substituir a identidade de um tablet comprometido),
não para qualquer decisão que o app tome sozinho.

## Coexistência v1/v2

O servidor continua aceitando o Bearer token v1 (`private.device_id_for_token`
verifica os dois esquemas) para qualquer dispositivo que ainda não tenha
sido atualizado para este build do app — mas o Android desta versão em
diante **só fala v2**: não existe mais nenhum caminho de código que leia ou
grave um token estático. Um tablet com um build antigo continua funcionando
normalmente até ser atualizado; ao instalar este build, ele reativa uma
única vez com um código novo (a mesma tela de ativação de sempre) e passa a
usar chave dali em diante, sem caminho de volta automático para o token.

## Onde cada peça mora

| Peça                                                    | Arquivo |
| -------------------------------------------------------- | ------- |
| Schema (`device_key_credentials`, nonces, sessões, desafios) | `supabase/migrations/20260812090000_device_key_authentication.sql` |
| Verificação de assinatura + ponte para token de sessão   | `supabase/functions/_shared/device-signature.ts` |
| Enrollment (start/complete)                               | `supabase/functions/device-enroll-key-start`, `device-enroll-key-complete` |
| Recuperação (start/complete)                               | `supabase/functions/device-recover-key-start`, `device-recover-key-complete` |
| Chave no Android (geração, assinatura, fingerprint)       | `apps/android/.../data/local/DeviceKeyStore.kt` |
| Conversão DER → raw r‖s (por que existe, ver seu próprio comentário) | `apps/android/.../data/local/EcdsaSignatureFormat.kt` |
| Teste físico da assinatura no hardware real                | `apps/android/app/src/androidTest/.../DeviceKeyStoreInstrumentedTest.kt` |
| Construção da requisição canônica + headers                | `apps/android/.../data/remote/DeviceRequestSigner.kt` |
| Resolução de identidade + recuperação automática          | `apps/android/.../data/repository/DeviceRepository.kt` |
| Painel: card "Autenticação do tablet"                     | `apps/admin/components/device-key-identity-panel.tsx` |
| Testes pgTAP (36 asserções)                                | `supabase/tests/017_device_key_authentication.test.sql` |
