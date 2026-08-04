# MAXCAR — Ciclo de vida de motoristas, veículos e dispositivos

Como o painel administra o ciclo de vida completo de um registro de frota:
não apenas criar e editar, mas desativar, arquivar, restaurar, desvincular
e excluir permanentemente. Para o log dessas ações, veja
[AUDIT_LOG.md](AUDIT_LOG.md).

## Três ações diferentes, três propósitos diferentes

| Ação          | O registro continua visível?     | Pode operar? | Reversível?     |
| ------------- | -------------------------------- | ------------ | --------------- |
| **Desativar** | Sim, nas listas normais          | Não          | Sim (Reativar)  |
| **Arquivar**  | Não, some das listas padrão      | Não          | Sim (Restaurar) |
| **Excluir**   | Não, o registro deixa de existir | —            | **Não**         |

Desativar muda o `status` operacional existente (o mesmo enum já usado por
`drivers.status`/`vehicles.status`/`devices.status`); arquivar é uma
dimensão independente (`archived_at`), então um registro pode estar
arquivado e ainda ter qualquer status — as duas coisas não se confundem.

## Onde cada ação vive

Toda mutação passa por uma função `SECURITY DEFINER` no banco
(`archive_driver`, `restore_driver`, `set_driver_active`,
`delete_driver_permanently`, e as equivalentes para `vehicle`/`device`) —
nunca um `UPDATE`/`DELETE` direto do cliente. Cada uma:

1. revalida o papel do chamador (`private.require_fleet_manager()` para
   arquivar/desativar/desvincular — `super_admin`/`admin`/`operations`;
   checagem própria de `super_admin` para exclusão permanente);
2. aplica a mudança;
3. grava um evento de auditoria na mesma transação — nunca é possível a
   ação acontecer sem o registro correspondente.

No painel, `apps/admin/components/fleet-lifecycle-actions.tsx` é o
componente único reaproveitado nas três telas de detalhe
(`/motoristas/[id]`, `/veiculos/[id]`, `/dispositivos/[id]`); os Server
Actions específicos de cada entidade vivem em `lifecycle-actions.ts` dentro
da própria rota.

## Exclusão permanente

Restrita a `super_admin`, exige três coisas na mesma submissão:

- **senha atual** — reautenticada no servidor via
  `supabase.auth.signInWithPassword` (`lib/auth/reauth.ts`), nunca uma
  comparação própria; a senha nunca é logada, salva ou reutilizada depois
  da checagem;
- **o texto `EXCLUIR`** digitado explicitamente;
- **um motivo**, obrigatório, gravado na auditoria.

## Quando a exclusão é bloqueada

A função de exclusão nunca reimplementa "existe histórico?" com uma
consulta própria quando uma constraint já responde isso: tentar apagar um
motorista com `driver_sessions`, ou um dispositivo com
`device_heartbeats`/`impressions`/`geofence_events`, dispara a violação de
chave estrangeira (`ON DELETE RESTRICT`, já existente desde MAX-002/003) e
a função a converte numa mensagem amigável:

> "Este registro possui histórico operacional e não pode ser apagado. Você
> pode desativá-lo ou arquivá-lo."

Um veículo com um dispositivo ainda vinculado é bloqueado explicitamente
(pede para desvincular primeiro) mesmo que o vínculo em si seja
`ON DELETE SET NULL` — a checagem existe para deixar a intenção clara ao
operador, não porque o banco quebraria sem ela.

Excluir um dispositivo revoga primeiro qualquer código de ativação
pendente e credencial ativa (mesmas RPCs do MAX-006), antes de tentar
apagar a linha.

## Filtros

`/motoristas`, `/veiculos` e `/dispositivos` mostram por padrão apenas
registros não arquivados. Um seletor "Arquivamento" alterna entre **Não
arquivados** (padrão), **Arquivados** e **Todos**. Um registro arquivado
recebe um selo "Arquivado" visível na lista, ao lado do status normal.
