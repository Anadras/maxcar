import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  archiveDriver,
  deleteDriverPermanently,
  restoreDriver,
  setDriverActive,
} from '../lifecycle-actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FleetLifecycleActions } from '@/components/fleet-lifecycle-actions';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDriver } from '@/lib/data/drivers';
import { formatDateTime } from '@/lib/fleet';

const LABEL = {
  pending: 'Pendente',
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
} as const;

export default async function DriverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [driver, auth] = await Promise.all([getDriver(id), getAuthContext()]);
  if (!driver) notFound();
  const canWrite = Boolean(auth && canManageFleet(auth.profile.role));
  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Motoristas', href: '/motoristas' },
          { label: driver.full_name },
        ]}
      />
      <PageHeader
        eyebrow="PILOTO"
        title={driver.full_name}
        description={
          driver.vehicle_code
            ? `Vinculado ao ${driver.vehicle_code}`
            : 'Sem veículo vinculado'
        }
        action={
          <div className="header-actions">
            {canWrite && !driver.vehicle_id && (
              <Link
                className="button button-secondary"
                href={`/veiculos/novo?driver=${id}`}
              >
                ＋ Adicionar veículo
              </Link>
            )}
            {canWrite && (
              <Link
                className="button button-primary"
                href={`/motoristas/${id}/editar`}
              >
                Editar
              </Link>
            )}
          </div>
        }
      />
      <SectionCard title="Motorista, veículo e tablet">
        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge value={LABEL[driver.status]} />
            </dd>
          </div>
          <div>
            <dt>Documento</dt>
            <dd>{driver.document_number ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{driver.phone ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{driver.email ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Veículo</dt>
            <dd>
              {driver.vehicle_id ? (
                <Link href={`/veiculos/${driver.vehicle_id}`}>
                  {driver.vehicle_code}
                </Link>
              ) : (
                'Sem vínculo'
              )}
            </dd>
          </div>
          <div>
            <dt>Placa</dt>
            <dd>{driver.license_plate ?? '—'}</dd>
          </div>
          <div>
            <dt>Tablet</dt>
            <dd>
              {driver.device_id ? (
                <Link href={`/dispositivos/${driver.device_id}`}>
                  {driver.device_code}
                </Link>
              ) : driver.vehicle_id ? (
                <>
                  Sem tablet instalado
                  {canWrite && (
                    <>
                      {' · '}
                      <Link
                        href={`/dispositivos/novo?vehicle=${driver.vehicle_id}`}
                      >
                        instalar
                      </Link>
                    </>
                  )}
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard
        title="Histórico de sessões"
        subtitle="Últimas 20 jornadas registradas"
      >
        {driver.sessions.length === 0 ? (
          <p className="section-empty">Nenhuma sessão registrada.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Veículo</th>
                  <th>Dispositivo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {driver.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{formatDateTime(session.started_at)}</td>
                    <td>{formatDateTime(session.ended_at)}</td>
                    <td>{session.vehicles?.internal_code ?? '—'}</td>
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
          </div>
        )}
      </SectionCard>
      {canWrite && (
        <SectionCard
          title="Ciclo de vida"
          subtitle="Desativar, arquivar e excluir são ações distintas — veja docs/admin/FLEET_LIFECYCLE.md."
        >
          <FleetLifecycleActions
            entityLabel="motorista"
            entityDisplayName={driver.full_name}
            isArchived={Boolean(driver.archived_at)}
            isActive={driver.status !== 'inactive'}
            isSuperAdmin={auth?.profile.role === 'super_admin'}
            archiveAction={archiveDriver.bind(null, id)}
            restoreAction={restoreDriver.bind(null, id)}
            setActiveAction={setDriverActive.bind(null, id)}
            deleteAction={deleteDriverPermanently.bind(null, id)}
          />
        </SectionCard>
      )}
    </div>
  );
}
