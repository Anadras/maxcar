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
