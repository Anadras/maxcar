# MAXCAR — Auditoria de ações de frota

`public.audit_events` é o registro imutável de toda ação de ciclo de vida
(arquivar, restaurar, desativar, reativar, desvincular, excluir) sobre
motoristas, veículos e dispositivos — ver
[FLEET_LIFECYCLE.md](FLEET_LIFECYCLE.md) para o que cada ação significa.

## Estrutura

| Coluna            | Conteúdo                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| `actor_user_id`   | quem executou (`auth.uid()` no momento da ação)                                |
| `actor_role`      | papel do ator naquele momento (`private.current_app_role()`)                   |
| `action`          | `archive` \| `restore` \| `deactivate` \| `reactivate` \| `unlink` \| `delete` |
| `entity_type`     | `driver` \| `vehicle` \| `device`                                              |
| `entity_id`       | id original do registro (continua existindo mesmo após exclusão)               |
| `entity_label`    | nome/código legível (nome do motorista, código do veículo/tablet)              |
| `reason`          | motivo informado (obrigatório só para exclusão permanente)                     |
| `before_snapshot` | `to_jsonb` da linha inteira antes da ação                                      |
| `metadata`        | reservado para contexto adicional futuro                                       |
| `created_at`      | horário do servidor — nunca o relógio do cliente                               |

## O que nunca é gravado

Senha, token, credencial de dispositivo, código de enrollment ou qualquer
segredo de API. A auditoria registra _o quê_ e _por quê_, nunca as
credenciais usadas para autorizar a ação.

## Escrita

Só através de `private.record_audit_event`, chamada exclusivamente pelas
funções de ciclo de vida (`archive_driver`, `delete_device_permanently`
etc.) — nunca diretamente pelo cliente. Escrever e agir sempre acontece na
mesma transação: se a ação falha, o evento de auditoria correspondente
nunca é gravado (e vice-versa).

## Leitura

RLS restringe `select` a `super_admin` (`audit_events_super_admin_select`).
Nenhuma política de `insert`/`update`/`delete` existe para `authenticated`
— nem um `super_admin` pode alterar ou apagar um evento de auditoria pelo
painel; é, na prática, um log imutável.

## Consulta manual (quando necessário)

```sql
select action, entity_type, entity_label, reason, actor_role, created_at
from public.audit_events
order by created_at desc
limit 50;
```

Uma tela dedicada de auditoria no painel (listagem, filtro por entidade,
por ator, por período) não foi construída neste marco — a tabela e a RLS
já suportam isso; falta apenas a UI de leitura, que pode ser adicionada
sem migração.
