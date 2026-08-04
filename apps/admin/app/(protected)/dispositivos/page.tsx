import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listDevices } from '@/lib/data/devices';
import { listVehicles } from '@/lib/data/vehicles';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';

const LOW_BATTERY_THRESHOLD = 20;

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    connection?: string;
    link?: string;
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
  const [devices, allDevices, activeVehicles, auth] = await Promise.all([
    listDevices(params.q, params.connection, params.link, archived),
    listDevices(),
    listVehicles('', 'active'),
    getAuthContext(),
  ]);
  const canWrite = !!auth && canManageFleet(auth.profile.role);

  const attention = [
    {
      key: 'offline',
      count: allDevices.filter((d) => d.connection_status === 'offline').length,
      label: 'offline',
      href: '/dispositivos?connection=offline',
    },
    {
      key: 'attention',
      count: allDevices.filter((d) => d.connection_status === 'attention')
        .length,
      label: 'em atenção',
      href: '/dispositivos?connection=attention',
    },
    {
      key: 'battery',
      count: allDevices.filter(
        (d) =>
          d.battery_level !== null && d.battery_level < LOW_BATTERY_THRESHOLD,
      ).length,
      label: 'com bateria baixa',
      href: '/dispositivos',
    },
    {
      key: 'unlinked',
      count: allDevices.filter((d) => d.vehicle_id === null).length,
      label: 'sem veículo vinculado',
      href: '/dispositivos?link=unlinked',
    },
    {
      key: 'vehicle-without-device',
      count: activeVehicles.filter((v) => v.device_id === null).length,
      label: 'veículo(s) ativo(s) sem tablet',
      href: '/veiculos',
    },
  ].filter((item) => item.count > 0);

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
      <SectionCard
        title="O que precisa de atenção agora"
        subtitle={
          attention.length === 0
            ? 'Nenhum ponto crítico identificado.'
            : undefined
        }
        className="attention-card"
      >
        {attention.length === 0 ? (
          <p className="section-empty">
            Toda a frota monitorada está saudável no momento.
          </p>
        ) : (
          <ul className="attention-list">
            {attention.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>
                  <strong>{item.count}</strong> {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
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
                      {device.archived_at && <StatusBadge value="Arquivado" />}
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
