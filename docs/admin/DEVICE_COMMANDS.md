# MAXCAR — Comandos remotos (MAX-009)

Como o painel pode pedir a um tablet para fazer algo, sem nunca lhe dar
acesso a shell arbitrário. Para o lado Android que consome esses comandos,
veja [ANDROID_SYNC.md](../architecture/ANDROID_SYNC.md).

## Um conjunto pequeno e fechado

Seis operações, todas seguras, nenhuma delas capaz de comprometer o
dispositivo mesmo se um comando fosse forjado:

| `command_type`         | O que faz no tablet                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `sync_now`             | Marcador — o tablet já está dentro de um ciclo de sync ao processar comandos; nada extra a fazer.                                       |
| `restart_player`       | Reseta o player para o início da grade atual (`PlayerViewModel.restart`).                                                               |
| `clear_obsolete_media` | Reexecuta a sincronização de grade REGULAR e regras GEO imediatamente, forçando a mesma reconciliação atômica que já roda a cada ciclo. |
| `enter_maintenance`    | Liga a flag local `AppPreferences.maintenanceRequested` — consumida pelo modo manutenção (MAX-010).                                     |
| `exit_maintenance`     | Desliga a mesma flag.                                                                                                                   |
| `update_config`        | Força um `refreshConfig()` imediato (já acontece a cada ciclo; o comando garante que não é preciso esperar o próximo).                  |

Não existe um sétimo tipo genérico "executar comando arbitrário" — o enum
do banco (`public.device_command_type`) é o próprio contrato: um tipo que
não existe nele não pode ser inserido, e o Android trata qualquer
`command_type` que não reconheça como falha explícita, nunca como um
no-op silencioso (`DeviceCommandExecutor`, ramo `else`).

## Ciclo de vida de um comando

```
pending  → (tablet sincroniza) → delivered → (tablet executa) → completed | failed
   └─ (nunca entregue a tempo) → expired
```

- **Emissão**: `create_device_command` (RPC), chamada pelo painel via
  `issueDeviceCommand` (Server Action), restrita aos mesmos papéis de
  gestão de frota (`super_admin`/`admin`/`operations`) —
  `private.require_fleet_manager()`, a mesma checagem do ciclo de vida de
  motoristas/veículos/dispositivos.
- **Entrega**: `get_device_pending_commands`, chamada pelo dispositivo a
  cada ciclo de sincronização (prioridade 7, sempre por último). Marca
  `pending → delivered` na mesma chamada — um comando entregue mas ainda
  não confirmado continua sendo retornado em polls seguintes, então uma
  falha de rede depois da entrega não perde o comando.
- **Confirmação**: `acknowledge_device_command`, chamada pelo dispositivo
  depois de executar (ou falhar em executar) — só aceita `completed` ou
  `failed`, nunca volta um comando para `pending`.
- **Expiração**: `expires_at` (1 hora após a criação, hoje fixo). Um
  comando ainda `pending` quando expira nunca é entregue — marcado
  `expired` na próxima vez que o dispositivo faz polling.

## Idempotência e auditoria

Cada comando é sua própria unidade de idempotência: o `id` (UUID) gerado
pelo servidor é o que o dispositivo confirma de volta, então reenviar o
mesmo `acknowledge` não duplica nada (`update ... where id = ...`, uma
operação naturalmente idempotente). A linha em si já é a auditoria —
`issued_by`, `created_at`, `delivered_at`, `completed_at`, `status`,
`result` — sem precisar de uma segunda escrita em `audit_events`, já que
um comando não é uma ação de ciclo de vida sobre um registro de frota (ver
[FLEET_LIFECYCLE.md](FLEET_LIFECYCLE.md)).

## RLS

`device_commands` não tem política de `insert`/`update`/`delete` para
`authenticated` — toda escrita passa pelas três funções `SECURITY DEFINER`
acima. Leitura (`select`) é permitida para os mesmos papéis de gestão de
frota, usada pelo histórico de comandos no detalhe do dispositivo.

## No painel

Card "Comandos remotos" em `/dispositivos/[id]`: um botão por tipo de
comando (rótulo em português, nunca o enum cru) e uma tabela com os
últimos 15 comandos enviados a este dispositivo — comando, status, quando
foi enviado/entregue/concluído.
