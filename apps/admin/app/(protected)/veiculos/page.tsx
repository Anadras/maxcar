import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { LiveStatusBadge, PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDevicesWithLatestHeartbeats } from '@/lib/data/devices';
import { listVehicles } from '@/lib/data/vehicles';

function tabletState(device: Awaited<ReturnType<typeof getDevicesWithLatestHeartbeats>>[number] | undefined) {
  if (!device) return null;
  if (device.connection_status === 'offline' || device.connection_status === 'inactive') return 'offline';
  if (device.player_state === 'no_ready_media') return 'fallback';
  if (device.current_campaign_id && device.current_campaign_id === device.last_geo_campaign_id) return 'geo';
  if (device.player_state === 'playing_confirmed') return 'playing';
  return 'attention';
}

const LABEL = {
  active: 'Ativo',
  offline: 'Offline',
  maintenance: 'Manutenção',
  unassigned: 'Não alocado',
  retired: 'Desativado',
} as const;

export default async function VehiclesPage({
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
  const [vehicles, auth, devices] = await Promise.all([
    listVehicles(params.q, params.status, archived),
    getAuthContext(),
    getDevicesWithLatestHeartbeats(),
  ]);
  const canWrite = !!auth && canManageFleet(auth.profile.role);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="OPERAÇÃO DE FROTA"
        title="Veículos"
        description="Cadastro, alocação e estado operacional da frota."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/veiculos/novo">
              ＋ Novo veículo
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
              placeholder="Código, placa, motorista ou tablet…"
            />
          </label>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="maintenance">Manutenção</option>
            <option value="unassigned">Não alocados</option>
            <option value="retired">Desativados</option>
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
        {vehicles.length === 0 ? (
          <EmptyState
            title="Nenhum veículo encontrado"
            description="Ajuste os filtros ou cadastre o primeiro veículo."
            action={
              canWrite
                ? { href: '/veiculos/novo', label: 'Criar veículo' }
                : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Veículo</th>
                  <th>Placa</th>
                  <th>Modelo</th>
                  <th>Motorista</th>
                  <th>Dispositivo</th>
                  <th>Estado do tablet</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => {
                  const tabletStatus = tabletState(
                    vehicle.device_id ? deviceById.get(vehicle.device_id) : undefined,
                  );
                  return (
                  <tr key={vehicle.id}>
                    <td>
                      <strong>{vehicle.internal_code}</strong>
                    </td>
                    <td>{vehicle.license_plate ?? '—'}</td>
                    <td>
                      {[vehicle.make, vehicle.model]
                        .filter(Boolean)
                        .join(' ') || '—'}
                    </td>
                    <td>{vehicle.driver_name ?? 'Sem vínculo'}</td>
                    <td>{vehicle.device_code ?? 'Sem dispositivo'}</td>
                    <td>{tabletStatus ? <LiveStatusBadge status={tabletStatus} /> : '—'}</td>
                    <td>
                      <StatusBadge value={LABEL[vehicle.status]} />
                      {vehicle.archived_at && <StatusBadge value="Arquivado" />}
                    </td>
                    <td>
                      <Link href={`/veiculos/${vehicle.id}`}>Abrir</Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
