import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { getAuthContext } from '@/lib/auth/context';
import { listAuditActors, listAuditEvents } from '@/lib/data/audit-events';

const ENTITY_LABELS: Record<string, string> = {
  advertiser: 'Cliente',
  establishment: 'Unidade',
  campaign: 'Campanha',
  driver: 'Piloto',
  vehicle: 'Veículo',
  device: 'Tablet',
};

const ACTION_LABELS: Record<string, string> = {
  archive: 'Arquivamento',
  restore: 'Restauração',
  deactivate: 'Desativação',
  reactivate: 'Reativação',
  unlink: 'Desvínculo',
  delete: 'Exclusão',
  set_maintenance_pin: 'PIN de manutenção alterado',
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    entityType?: string;
    action?: string;
    actor?: string;
  }>;
}) {
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') redirect('/configuracoes');
  const params = await searchParams;
  const [events, actors] = await Promise.all([
    listAuditEvents({
      from: params.from ? `${params.from}T00:00:00Z` : undefined,
      to: params.to ? `${params.to}T23:59:59Z` : undefined,
      entityType: params.entityType,
      action: params.action,
      actorUserId: params.actor,
    }),
    listAuditActors(),
  ]);
  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: 'Configurações', href: '/configuracoes' },
          { label: 'Auditoria' },
        ]}
      />
      <PageHeader
        eyebrow="SEGURANÇA"
        title="Histórico administrativo"
        description="Registro das exclusões, arquivamentos e alterações sensíveis. Últimos 200 eventos do filtro atual."
      />
      <SectionCard>
        <form className="audit-filters">
          <label>
            De
            <input type="date" name="from" defaultValue={params.from} />
          </label>
          <label>
            Até
            <input type="date" name="to" defaultValue={params.to} />
          </label>
          <select
            name="entityType"
            defaultValue={params.entityType ?? ''}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos os tipos</option>
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="action"
            defaultValue={params.action ?? ''}
            aria-label="Filtrar por ação"
          >
            <option value="">Todas as ações</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="actor"
            defaultValue={params.actor ?? ''}
            aria-label="Filtrar por usuário"
          >
            <option value="">Todos os usuários</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.full_name ?? actor.id}
              </option>
            ))}
          </select>
          <button className="button button-secondary" type="submit">
            Filtrar
          </button>
        </form>
        {events.length === 0 ? (
          <EmptyState
            title="Nenhuma ação registrada"
            description="Ajuste os filtros ou aguarde novas ações administrativas."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ação</th>
                  <th>Tipo</th>
                  <th>Registro</th>
                  <th>Usuário</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(event.created_at))}
                    </td>
                    <td>
                      <StatusBadge
                        value={ACTION_LABELS[event.action] ?? event.action}
                      />
                    </td>
                    <td>
                      {ENTITY_LABELS[event.entity_type] ?? event.entity_type}
                    </td>
                    <td>
                      <strong>{event.entity_label}</strong>
                    </td>
                    <td>{event.actor_name}</td>
                    <td>{event.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
