import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getVehicle } from '@/lib/data/vehicles';
import { formatDateTime } from '@/lib/fleet';

const LABEL = {
  active: 'Ativo',
  offline: 'Offline',
  maintenance: 'Manutenção',
  unassigned: 'Não alocado',
  retired: 'Desativado',
} as const;

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [vehicle, auth] = await Promise.all([getVehicle(id), getAuthContext()]);
  if (!vehicle) notFound();
  const canWrite = Boolean(auth && canManageFleet(auth.profile.role));
  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Frota' },
          { label: 'Veículos', href: '/veiculos' },
          { label: vehicle.internal_code },
        ]}
      />
      <PageHeader
        eyebrow="VEÍCULO"
        title={vehicle.internal_code}
        description={vehicle.license_plate ?? 'Sem placa informada'}
        action={
          <div className="header-actions">
            {canWrite && !vehicle.device_id && (
              <Link
                className="button button-secondary"
                href={`/dispositivos/novo?vehicle=${id}`}
              >
                ＋ Instalar tablet
              </Link>
            )}
            {canWrite && (
              <Link
                className="button button-primary"
                href={`/veiculos/${id}/editar`}
              >
                Editar vínculos
              </Link>
            )}
          </div>
        }
      />
      <SectionCard title="Dados e vínculos">
        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge value={LABEL[vehicle.status]} />
            </dd>
          </div>
          <div>
            <dt>Placa</dt>
            <dd>{vehicle.license_plate ?? 'Não informada'}</dd>
          </div>
          <div>
            <dt>Marca / modelo</dt>
            <dd>
              {[vehicle.make, vehicle.model].filter(Boolean).join(' ') ||
                'Não informado'}
            </dd>
          </div>
          <div>
            <dt>Ano</dt>
            <dd>{vehicle.year ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Motorista</dt>
            <dd>
              {vehicle.driver_id ? (
                <Link href={`/motoristas/${vehicle.driver_id}`}>
                  {vehicle.driver_name}
                </Link>
              ) : (
                'Sem vínculo'
              )}
            </dd>
          </div>
          <div>
            <dt>Dispositivo</dt>
            <dd>
              {vehicle.device_id ? (
                <Link href={`/dispositivos/${vehicle.device_id}`}>
                  {vehicle.device_code}
                </Link>
              ) : (
                'Sem vínculo'
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard title="Histórico de sessões">
        <div className="table-wrap">
          {vehicle.sessions.length === 0 ? (
            <p className="section-empty">Nenhuma sessão registrada.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Motorista</th>
                  <th>Dispositivo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vehicle.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{formatDateTime(session.started_at)}</td>
                    <td>{formatDateTime(session.ended_at)}</td>
                    <td>{session.drivers?.full_name ?? '—'}</td>
                    <td>{session.devices?.device_code ?? '—'}</td>
                    <td>
                      <StatusBadge
                        value={
                          session.status === 'active'
                            ? 'Ativa'
                            : session.status === 'completed'
                              ? 'Concluída'
                              : 'Cancelada'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
