# MAXCAR — Ativação (enrollment) do tablet

Como um tablet novo, sem identidade prévia, vira um dispositivo autenticado.
Cobre o fluxo ponta a ponta: painel → Edge Function → Android. Para o modelo
de ameaça e as garantias de segurança por trás de cada passo, veja
[DEVICE_SECURITY.md](DEVICE_SECURITY.md); para o esquema de assinatura por
chave em detalhe, veja [DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md).

> **MAX-010.6**: desde este marco, o código de ativação continua sendo o
> mesmo texto humano-digitável de sempre, mas o que ele ativa mudou — em vez
> de devolver um token estático guardado em disco, o fluxo agora prova posse
> de uma chave EC P-256 gerada no Android Keystore, que nunca sai do
> aparelho. O código abaixo descreve esse fluxo atual; a seção
> ["MAX-011: instabilidade de armazenamento"](#max-011-instabilidade-de-armazenamento-não-resolvida-num-tablet-físico)
> ao final documenta, como registro histórico, o problema que motivou essa
> mudança.

## Visão geral do fluxo

```text
painel (staff)              banco                    Android
     │  gera código             │                         │
     ├──────────────────────────▶ device_enrollment_codes  │
     │  mostra código uma vez    │                         │
     │                           │                         │
     │                           │◀── operador digita ─────┤
     │                           │    o código no tablet    │
     │                           │                         │
     │              device-enroll-key-start (Edge Function) │
     │                           │◀── code + chave pública ─┤
     │                           │───────── desafio ───────▶│
     │                           │                         │  assina o desafio
     │             device-enroll-key-complete (Edge Function)│  com a chave privada
     │                           │◀── enrollmentAttemptId + │
     │                           │       assinatura ────────┤
     │                           │──── device_id/key_id ───▶│
     │                           │                         │
     │                           │◀── requisição assinada ──┤
```

## No painel

`/dispositivos/[id]` mostra dois cards distintos, deliberadamente separados
já que um dispositivo só usa um esquema por vez:

- **"Ativação do tablet"** (`apps/admin/components/device-enrollment-panel.tsx`),
  com três estados vindos de `device_enrollment_admin_view`
  (`apps/admin/lib/data/devices.ts#getDeviceEnrollment`): **Não ativado**
  (sem código pendente e sem credencial), **Código pendente** (um código foi
  gerado e ainda não expirou/foi usado), **Ativado** (existe uma credencial
  v1 — token estático — não revogada). Continua sendo o ponto de partida
  para qualquer ativação, incluindo a v2 por chave: o mesmo código
  humano-digitável de sempre é o que o Android usa para provar posse da
  chave no `device-enroll-key-start`/`-complete`.
- **"Autenticação do tablet"** (`apps/admin/components/device-key-identity-panel.tsx`),
  com o estado da identidade v2 vindo de `device_key_admin_view`
  (`apps/admin/lib/data/devices.ts#getDeviceKeyIdentity`): se há uma chave
  ativa, o algoritmo, se é protegida por hardware, quando foi ativada e o
  último uso; se não há, um aviso indicando se o tablet ainda está no
  esquema v1 (token estático) ou nunca foi ativado. Ver
  [DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md).

"Gerar código" chama `generateEnrollmentCode`
(`apps/admin/app/(protected)/dispositivos/enrollment-actions.ts`), que
invoca a RPC `generate_device_enrollment_code` e devolve o código em texto
puro **uma única vez**, como estado de componente (`useActionState`) — nunca
por redirect ou parâmetro de URL, para não deixar o código no histórico do
navegador. Volta a chamar a função gera um novo código e revoga
automaticamente qualquer código pendente anterior. Esse mesmo código serve
tanto para uma primeira ativação por chave quanto para reativar um tablet
que precise de uma identidade nova.

Revogar usa as RPCs `revoke_device_enrollment_code` (código pendente),
`revoke_device_credential` (credencial v1) e `revoke_device_key`
(identidade v2), todas atrás de `ConfirmSubmitButton` quando desativam algo
já ativo — desativa o tablet imediatamente.

Todas essas ações exigem `canManageFleet` (papel `super_admin`, `admin` ou
`operations`); a mesma checagem de papel existe de novo dentro das funções
`SECURITY DEFINER` no banco, então um bug na Server Action nunca vira uma
brecha de autorização.

## Código de ativação

- 8 caracteres, alfabeto de 32 símbolos sem `0/O/1/I/L`
  (`private.generate_friendly_code`), pensado para ser digitado à mão numa
  tela sem teclado físico.
- Expira em 15 minutos e é de uso único; o banco guarda só o hash SHA-256
  (`device_enrollment_codes.code_hash`), nunca o texto puro.
- Tentativas malsucedidas de ativação são registradas por instalação
  (`device_enrollment_attempts`) e bloqueiam novas tentativas depois de 10
  falhas em 15 minutos (`23514`, mapeado para HTTP 429).

## No Android

`ui/enrollment/EnrollmentScreen.kt` + `EnrollmentViewModel.kt`: campo de
texto para o código (teclado em maiúsculas), o `installation_id` truncado
exibido para o operador conferir contra o painel, e mensagens de erro em
português mapeadas uma a uma a partir de `DeviceApiError`
(sem stack trace, nunca):

| Erro                                         | Mensagem exibida                          |
| -------------------------------------------- | ----------------------------------------- |
| `NetworkUnavailable`                         | Sem conexão                               |
| `EnrollmentInvalid` (código errado/expirado) | Código inválido ou expirado               |
| `EnrollmentInvalid` (já usado)               | Código inválido ou já utilizado           |
| `RateLimited`                                | Muitas tentativas                         |
| `ServerError`/`Unexpected`                   | Servidor indisponível (mensagem genérica) |

Ao enviar, `DeviceRepository.enroll(code)` gera (ou reutiliza, numa
repetição) a chave EC P-256 do Keystore via `DeviceKeyStore.getOrCreateKeyInfo()`,
chama `device-enroll-key-start` com o `installation_id` persistido (gerado
uma vez por `InstallationIdStore`, nunca reaproveitando `ANDROID_ID` ou
outro identificador de hardware) e a chave pública/fingerprint, assina o
desafio devolvido e chama `device-enroll-key-complete`. A resposta traz o
`key_id` (não-secreto — guardado em `DeviceStateEntity`, junto com os dados
de dispositivo/veículo) e nenhum segredo, já que o único segredo (a chave
privada) nunca saiu do Keystore. Em caso de sucesso, `EnrollmentViewModel`
agenda `InitialSyncWorker` e a tela troca para `DeviceHomeScreen`.

`MainActivity.kt` decide qual tela mostrar observando
`DeviceRepository.isEnrolled` (`Flow<Boolean>`, apoiado em DataStore):
`null` inicial não renderiza nada (evita o flash entre estados), `true` vai
para `DeviceHomeScreen`, `false` para `EnrollmentScreen`.

## Revogação

Uma identidade revogada no painel não apaga nada no tablet. O próximo
heartbeat recebe 401, `DeviceRepository.handleUnauthorizedDeviceKey()`
limpa **apenas** o pareamento local `key_id` — a chave física no Keystore, o
histórico em Room e a fila de eventos pendentes continuam intactos. O ciclo
seguinte tenta recuperar a identidade automaticamente (ver
[DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md#recuperação-identidade-sem-um-novo-código));
como a chave foi de fato revogada no servidor, essa tentativa falha do mesmo
jeito controlado que um fingerprint desconhecido, e o app mostra o aviso
"credencial ausente localmente" em vez de voltar sozinho para
`EnrollmentScreen`. Uma falha de rede nunca passa por esse caminho; só uma
rejeição explícita do servidor derruba o pareamento local. Reativar gera um
novo código no painel e repete o fluxo de enrollment; `DeviceStateEntity` é
reescrito com os dados da nova identidade, reaproveitando a mesma chave do
Keystore se ela ainda existir.

## Credencial local ilegível ≠ revogação (MAX-011 Bloco A, preservado no MAX-010.6)

Um bug real, identificado num piloto em campo com o esquema v1 (token
estático), fazia o tablet pedir um novo código de ativação com frequência
mesmo com a credencial ainda válida no servidor: as chamadas de
sincronização liam o token local e, quando `null` — por qualquer motivo,
não só revogação real: uma escrita ainda não confirmada em disco, uma falha
momentânea do Keystore — lançavam o **mesmo** `DeviceApiError.Unauthorized`
que uma resposta HTTP 401 real produz. O manipulador de falha, que só
deveria reagir a uma rejeição confirmada do servidor, não conseguia
distinguir os dois casos e limpava `isEnrolled` sem nunca ter feito uma
chamada de rede.

Corrigido com um tipo de erro dedicado,
`DeviceApiError.CredentialUnavailable` — nunca lançado a partir de uma
resposta do servidor, só quando a resolução local de identidade
(`DeviceRepository.resolveKeyId`) não encontra uma chave utilizável antes de
qualquer chamada de rede acontecer. Essa mesma garantia se aplica ao esquema
v2: só `DeviceApiError.Unauthorized` (uma resposta HTTP 401 real) aciona
`handleUnauthorizedDeviceKey()`; `CredentialUnavailable` é tratado como
"tentar de novo no próximo ciclo" (`SyncOutcome.RETRY` no
`SyncCoordinator`), nunca como desativação. Quando isso acontece com o
dispositivo marcado como ativado, `AppPreferences.credentialMissingLocally`
fica `true` e o diagnóstico mostra um aviso com um botão explícito
"Reativar este tablet" (`DeviceRepository.reenrollAfterCredentialLoss`) —
uma recuperação decidida pelo operador, nunca automática. Diferente do
esquema v1, porém, o MAX-010.6 tenta uma recuperação automática *antes*
de chegar a esse aviso — ver
[DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md#recuperação-identidade-sem-um-novo-código)
— então o aviso agora só aparece quando a chave do Keystore em si
desapareceu, ou quando a recuperação automática já foi tentada e recusada
pelo servidor.

## MAX-011: instabilidade de armazenamento não resolvida num tablet físico

Um tablet físico usado neste piloto (MediaTek, não é de fato um Black
Shark/JoyUI genuíno — `pm list packages` não mostra nenhum pacote da Xiaomi
Black Shark, apenas serviços MediaTek genéricos e um `com.weibu.factorytest`
de fábrica) demonstrou uma falha de armazenamento séria e ainda não
totalmente diagnosticada: minutos depois de `enroll()` gravar e confirmar o
token com sucesso — inclusive completando um heartbeat real com ele — a
linha correspondente desaparece tanto das consultas do próprio app quanto
de uma leitura externa do arquivo do banco, **com o mesmo processo do app
continuamente vivo o tempo todo** (confirmado via `dumpsys activity
exit-info`, sem nenhum reinício de processo entre a escrita e o
desaparecimento). Nenhum caminho de código do MAXCAR apaga isoladamente
essa linha sem também apagar `isEnrolled` — e `isEnrolled` nunca muda — o
que descarta qualquer explicação do lado do app.

Três hipóteses foram testadas, cada uma com uma janela de observação limpa
de 6+ minutos sem nenhuma interação com o aparelho:

1. Trocar `EncryptedSharedPreferences` (Jetpack Security/Tink) por
   `device_credential` no Room, criptografado com uma chave do Android
   Keystore aplicada diretamente via `Cipher` — mesmo padrão de falha.
2. Trocar o `journal_mode` do Room de WAL para TRUNCATE (elimina a
   possibilidade de uma escrita ficar presa só no arquivo `-wal` sem nunca
   ser mesclada ao arquivo principal) — mesmo padrão de falha.
3. Desativar `com.mediatek.duraspeed` (o matador de processos em segundo
   plano da MediaTek, uma causa real e documentada dessa classe de sintoma
   em outros aparelhos) — mesmo padrão de falha.
4. Corrigir um bug real encontrado depois: `readToken()` tentava migrar o
   token do antigo `EncryptedSharedPreferences` toda vez que a linha do
   Room vinha vazia — sem nenhuma proteção contra repetição — o que
   significava reabrir e reinicializar o keyset Tink completo contra o
   Keystore a cada ciclo de 30s, para sempre, uma vez que a linha
   sumisse pela primeira vez. Corrigido com uma flag `@Volatile` que
   limita a tentativa de migração a uma única vez por processo. Testado
   com uma janela limpa de 15 minutos — mesmo padrão de falha.

Nenhuma das quatro resolveu o problema nesse aparelho específico. As
mudanças de código (1, 2 e 4) permanecem no projeto por serem, de
qualquer forma, mais robustas que o que havia antes — em particular a
correção 4 é uma proteção genuína contra desgaste desnecessário do
Keystore, independente de ser ou não a causa raiz — mas **nenhuma deve
ser tratada como a correção deste bug**. Uma verificação sistemática dos
logs do sistema (não só do processo do app) no momento exato da falha não
encontrou nenhum crash de keystore, vold, nem reinício de daemon — a
falha é silenciosa em todos os níveis observáveis via ADB.

O que está comprovado, de forma repetida e sob teste controlado: mesmo
durante essa instabilidade, o tablet nunca perde a ativação nem pede um
novo código — exatamente a garantia que a seção "Credencial local ilegível"
acima descreve. O diagnóstico (`credentialMissingLocally`) e a recuperação
manual (`reenrollAfterCredentialLoss`) funcionam corretamente o tempo todo;
o que falha é a sincronização automática continuar depois da primeira
tentativa bem-sucedida, não a integridade da ativação.

Próximos passos recomendados, ainda não executados: testar o mesmo cenário
num segundo aparelho físico (para confirmar se é uma falha desta unidade
específica ou do modelo/firmware inteiro); investigar mais serviços
MediaTek além do DuraSpeed (`com.mediatek.capctrl.service`,
`com.mediatek.batterywarning`); considerar armazenar o token fora do
sandbox privado do app (ex.: AccountManager) como última alternativa se o
armazenamento privado deste hardware provar ser fundamentalmente pouco
confiável.

### Desfecho: MAX-010.6 elimina a dependência em vez de continuar
### diagnosticando

Nenhuma dessas hipóteses foi confirmada como causa raiz antes do marco
seguinte mudar a abordagem por completo: em vez de continuar perseguindo por
que o armazenamento do token específico deste aparelho era instável, o
MAX-010.6 removeu o token estático inteiramente. `SecureTokenStore`,
`DeviceCredentialEntity` e a tabela `device_credential` local foram
apagados do código do Android; a identidade do dispositivo agora é uma
chave no Android Keystore (ver [DEVICE_KEY_AUTH.md](DEVICE_KEY_AUTH.md)),
que por natureza da própria API do Keystore não pode "desaparecer
silenciosamente" da mesma forma que uma linha de Room podia — e mesmo que o
registro local do `key_id` se perca de novo por qualquer motivo parecido, a
recuperação automática (mesmo documento, seção "Recuperação") fecha
exatamente esse loop sem precisar de um novo código. Esta seção permanece
como registro histórico do problema que motivou a mudança, não como
descrição do comportamento atual.
