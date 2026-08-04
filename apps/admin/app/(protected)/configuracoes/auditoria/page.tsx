import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { getAuthContext } from '@/lib/auth/context';
import { listAuditEvents } from '@/lib/data/audit-events';

const ENTITY_LABELS: Record<string, string> = {
  advertiser: 'Cliente',
  establishment: 'Unidade',
  campaign: 'Campanha',
  driver: 'Piloto',
  vehicle: 'Veículo',
  device: 'Tablet',
};

export default async function AuditPage() {
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') redirect('/configuracoes');
  const events = await listAuditEvents();
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
        description="Registro das exclusões, arquivamentos e alterações sensíveis."
      />
      <SectionCard>
        {events.length === 0 ? (
          <EmptyState
            title="Nenhuma ação registrada"
            description="As ações administrativas aparecerão aqui."
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
                        value={
                          event.action === 'delete' ? 'Exclusão' : event.action
                        }
                      />
                    </td>
                    <td>
                      {ENTITY_LABELS[event.entity_type] ?? event.entity_type}
                    </td>
                    <td>
                      <strong>{event.entity_label}</strong>
                    </td>
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
