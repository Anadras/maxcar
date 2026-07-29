import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listDevices } from '@/lib/data/devices';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    connection?: string;
    link?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const [devices, auth] = await Promise.all([
    listDevices(params.q, params.connection, params.link),
    getAuthContext(),
  ]);
  const canWrite = !!auth && canManageFleet(auth.profile.role);
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="MONITORAMENTO DA FROTA"
        title="Dispositivos"
        description="Tablets, vínculos e saúde calculada pelo último heartbeat real."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/dispositivos/novo">
              ＋ Novo dispositivo
            </Link>
          ) : undefined
        }
      />
      <SectionCard>
        <form className="fleet-filters fleet-filters-wide">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Código, veículo, placa ou motorista…"
            />
          </label>
          <select
            name="connection"
            defaultValue={params.connection ?? ''}
            aria-label="Conexão"
          >
            <option value="">Todas as conexões</option>
            <option value="online">Online</option>
            <option value="attention">Atenção</option>
            <option value="offline">Offline</option>
            <option value="inactive">Inativo</option>
          </select>
          <select
            name="link"
            defaultValue={params.link ?? ''}
            aria-label="Vínculo"
          >
            <option value="">Todos os vínculos</option>
            <option value="linked">Vinculados</option>
            <option value="unlinked">Sem veículo</option>
          </select>
          <button className="button button-secondary" type="submit">
            Filtrar
          </button>
        </form>
        {devices.length === 0 ? (
          <EmptyState
            title="Nenhum dispositivo encontrado"
            description="Ajuste os filtros ou cadastre o primeiro tablet."
            action={
              canWrite
                ? { href: '/dispositivos/novo', label: 'Criar dispositivo' }
                : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Veículo</th>
                  <th>Motorista</th>
                  <th>Conexão</th>
                  <th>Bateria</th>
                  <th>Rede / GPS</th>
                  <th>Último contato</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <strong>{device.device_code}</strong>
                      <small className="table-subline">
                        {device.app_version ?? 'Sem versão'}
                      </small>
                    </td>
                    <td>{device.vehicle_code ?? 'Sem vínculo'}</td>
                    <td>{device.driver_name ?? '—'}</td>
                    <td>
                      <StatusBadge
                        value={CONNECTION_LABEL[device.connection_status]}
                      />
                    </td>
                    <td>
                      {device.battery_level === null
                        ? '—'
                        : `${device.battery_level}%`}
                    </td>
                    <td>
                      {device.network_connected === null
                        ? 'Sem dados'
                        : `${device.network_connected ? 'Rede OK' : 'Sem rede'} · ${device.gps_available ? 'GPS OK' : 'Sem GPS'}`}
                    </td>
                    <td>{formatRelativeTime(device.heartbeat_at)}</td>
                    <td>
                      <Link href={`/dispositivos/${device.id}`}>Abrir</Link>
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
