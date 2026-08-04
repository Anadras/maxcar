# MAXCAR — Ativação (enrollment) do tablet

Como um tablet novo, sem identidade prévia, vira um dispositivo autenticado.
Cobre o fluxo ponta a ponta: painel → Edge Function → Android. Para o modelo
de ameaça e as garantias de segurança por trás de cada passo, veja
[DEVICE_SECURITY.md](DEVICE_SECURITY.md).

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
     │                    device-enroll (Edge Function)     │
     │                           │◀── code + installation_id│
     │                           │──── device_token ───────▶│
     │                           │                         │
     │                           │◀── heartbeat autenticado ┤
```

## No painel

`/dispositivos/[id]` mostra o card "Ativação do tablet"
(`apps/admin/components/device-enrollment-panel.tsx`), com três estados
possíveis vindos de `device_enrollment_admin_view`
(`apps/admin/lib/data/devices.ts#getDeviceEnrollment`):

- **Não ativado** — sem código pendente e sem credencial.
- **Código pendente** — um código foi gerado e ainda não expirou/foi usado.
- **Ativado** — existe uma credencial de dispositivo não revogada.

"Gerar código" chama `generateEnrollmentCode`
(`apps/admin/app/(protected)/dispositivos/enrollment-actions.ts`), que
invoca a RPC `generate_device_enrollment_code` e devolve o código em texto
puro **uma única vez**, como estado de componente (`useActionState`) — nunca
por redirect ou parâmetro de URL, para não deixar o código no histórico do
navegador. Volta a chamar a função gera um novo código e revoga
automaticamente qualquer código pendente anterior.

Revogar (código pendente ou credencial já emitida) usa as RPCs
`revoke_device_enrollment_code` / `revoke_device_credential`, atrás de
`ConfirmSubmitButton` para a revogação de credencial — ela desativa o tablet
imediatamente.

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

Ao enviar, `DeviceRepository.enroll(code)` chama a Edge Function
`device-enroll` com o `installation_id` persistido (gerado uma vez por
`InstallationIdStore`, nunca reaproveitando `ANDROID_ID` ou outro
identificador de hardware). A resposta traz o `device_token` (guardado
imediatamente em `SecureTokenStore`, nunca em Room/DataStore/log) e os dados
do dispositivo/veículo (gravados em `DeviceStateEntity`). Em caso de sucesso,
`EnrollmentViewModel` agenda `InitialSyncWorker` e a tela troca para
`DeviceHomeScreen`.

`MainActivity.kt` decide qual tela mostrar observando
`DeviceRepository.isEnrolled` (`Flow<Boolean>`, apoiado em DataStore):
`null` inicial não renderiza nada (evita o flash entre estados), `true` vai
para `DeviceHomeScreen`, `false` para `EnrollmentScreen`.

## Revogação

Uma credencial revogada no painel não apaga nada no tablet. O próximo
heartbeat recebe 401, `DeviceRepository.handleRevocation()` limpa **apenas**
o token e a flag `isEnrolled` — histórico em Room e a fila de eventos
pendentes continuam intactos — e a UI volta para `EnrollmentScreen`. Uma
falha de rede nunca passa por esse caminho; só uma rejeição explícita do
servidor revoga localmente. Reativar gera um novo código no painel e repete o
fluxo acima; `DeviceStateEntity` é reescrito com os dados da nova credencial,
como na primeira ativação.

## Credencial local ilegível ≠ revogação (MAX-011 Bloco A)

Um bug real, identificado num piloto em campo, fazia o tablet pedir um novo
código de ativação com frequência mesmo com a credencial ainda válida no
servidor: `sendHeartbeat`/`refreshConfig`/`MediaDownloadManager.sync`/
`GeoRulesSyncManager.sync` liam o token local e, quando `null` — por
qualquer motivo, não só revogação real: uma escrita ainda não confirmada em
disco, uma falha momentânea do Keystore — lançavam o **mesmo**
`DeviceApiError.Unauthorized` que uma resposta HTTP 401 real produz. O
manipulador de falha, que só deveria reagir a uma rejeição confirmada do
servidor, não conseguia distinguir os dois casos e limpava `isEnrolled`
sem nunca ter feito uma chamada de rede.

Corrigido com um tipo de erro dedicado,
`DeviceApiError.CredentialUnavailable` — nunca lançado a partir de uma
resposta do servidor, só quando a leitura local falha antes de qualquer
chamada de rede acontecer. Só `DeviceApiError.Unauthorized` (uma resposta
HTTP 401 real) aciona `handleRevocation()`; `CredentialUnavailable` é
tratado como "tentar de novo no próximo ciclo" (`SyncOutcome.RETRY` no
`SyncCoordinator`), nunca como desativação. Quando isso acontece com o
dispositivo marcado como ativado, `AppPreferences.credentialMissingLocally`
fica `true` e o diagnóstico mostra um aviso com um botão explícito
"Reativar este tablet" (`DeviceRepository.reenrollAfterCredentialLoss`) —
uma recuperação decidida pelo operador, nunca automática.

`SecureTokenStore.saveToken`/`clear` também passaram a usar
`commit()` (síncrono) em vez de `apply()` (assíncrono): salvar o token e
marcar `isEnrolled = true` precisam ser efetivamente duráveis antes que
qualquer ciclo de sync seguinte possa rodar, ou uma queda do processo bem
no meio da ativação deixaria exatamente esse mesmo estado inconsistente
(marcado como ativado, sem token gravado em disco).
