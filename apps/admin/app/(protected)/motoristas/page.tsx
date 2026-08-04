import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listDrivers } from '@/lib/data/drivers';

const LABEL = {
  pending: 'Pendente',
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
} as const;

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    archived?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const archived =
    params.archived === 'archived' || params.archived === 'all'
      ? params.archived
      : 'active';
  const [drivers, auth] = await Promise.all([
    listDrivers(params.q, params.status, archived),
    getAuthContext(),
  ]);
  const canWrite = !!auth && canManageFleet(auth.profile.role);
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="OPERAÇÃO DE FROTA"
        title="Pilotos"
        description="Abra um piloto para cuidar do motorista, veículo e tablet em um só lugar."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/motoristas/novo">
              ＋ Novo piloto
            </Link>
          ) : undefined
        }
      />
      <SectionCard>
        <form className="fleet-filters">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Nome, documento ou veículo…"
            />
          </label>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="pending">Pendentes</option>
            <option value="inactive">Inativos</option>
            <option value="suspended">Suspensos</option>
          </select>
          <select
            name="archived"
            defaultValue={archived}
            aria-label="Arquivamento"
          >
            <option value="active">Não arquivados</option>
            <option value="archived">Arquivados</option>
            <option value="all">Todos</option>
          </select>
          <button className="button button-secondary" type="submit">
            Filtrar
          </button>
        </form>
        {drivers.length === 0 ? (
          <EmptyState
            title="Nenhum piloto encontrado"
            description="Ajuste os filtros ou cadastre o primeiro piloto."
            action={
              canWrite
                ? { href: '/motoristas/novo', label: 'Criar piloto' }
                : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Piloto</th>
                  <th>Veículo</th>
                  <th>Tablet</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((driver) => (
                  <tr key={driver.id}>
                    <td>
                      <strong>{driver.full_name}</strong>
                    </td>
                    <td>{driver.vehicle_code ?? 'Sem veículo'}</td>
                    <td>{driver.device_code ?? 'Sem tablet'}</td>
                    <td>
                      <StatusBadge value={LABEL[driver.status]} />
                      {driver.archived_at && <StatusBadge value="Arquivado" />}
                    </td>
                    <td>
                      <Link href={`/motoristas/${driver.id}`}>Abrir</Link>
                    </td>
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
