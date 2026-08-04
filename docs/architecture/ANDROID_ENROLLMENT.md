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

`DeviceRepository.enroll()` também passou a verificar o retorno de
`SecureTokenStore.saveToken()` — que agora devolve `Boolean`, não `Unit` —
antes de marcar `isEnrolled = true`. Um piloto em campo demonstrou
exatamente essa falha: `saveToken()` não lançava exceção nenhuma, mas a
escrita nunca chegava a persistir de fato; o app seguia adiante e marcava a
ativação como concluída mesmo assim. `enroll()` agora falha (nunca marca
`isEnrolled`) sempre que `saveToken()` reportar que a escrita não foi
durável.

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

Nenhuma das três resolveu o problema nesse aparelho específico. As três
mudanças de código (1 e 2) permanecem no projeto por serem, de qualquer
forma, mais robustas que o que havia antes, mas **não devem ser tratadas
como a correção deste bug** — apenas como melhorias de robustez gerais.

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
