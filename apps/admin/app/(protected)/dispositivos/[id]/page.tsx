import Link from 'next/link';
import { notFound } from 'next/navigation';
import { simulateHeartbeat } from '../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDevice } from '@/lib/data/devices';
import {
  CONNECTION_LABEL,
  formatDateTime,
  formatRelativeTime,
} from '@/lib/fleet';

export default async function DeviceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [device, auth] = await Promise.all([getDevice(id), getAuthContext()]);
  if (!device) notFound();
  const canSimulate =
    process.env.NODE_ENV !== 'production' &&
    auth?.profile.role === 'super_admin';
  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Frota' },
          { label: 'Dispositivos', href: '/dispositivos' },
          { label: device.device_code },
        ]}
      />
      <PageHeader
        eyebrow="DISPOSITIVO"
        title={device.device_code}
        description={`Último contato: ${formatRelativeTime(device.heartbeat_at)}`}
        action={
          auth && canManageFleet(auth.profile.role) ? (
            <Link
              className="button button-primary"
              href={`/dispositivos/${id}/editar`}
            >
              Editar
            </Link>
          ) : undefined
        }
      />
      <SectionCard title="Saúde atual">
        <dl className="detail-grid">
          <div>
            <dt>Conexão</dt>
            <dd>
              <StatusBadge value={CONNECTION_LABEL[device.connection_status]} />
            </dd>
          </div>
          <div>
            <dt>Ciclo operacional</dt>
            <dd>
              <StatusBadge value={device.status} />
            </dd>
          </div>
          <div>
            <dt>Veículo</dt>
            <dd>
              {device.vehicle_id ? (
                <Link href={`/veiculos/${device.vehicle_id}`}>
                  {device.vehicle_code}
                </Link>
              ) : (
                'Sem vínculo'
              )}
            </dd>
          </div>
          <div>
            <dt>Motorista</dt>
            <dd>
              {device.driver_id ? (
                <Link href={`/motoristas/${device.driver_id}`}>
                  {device.driver_name}
                </Link>
              ) : (
                'Sem vínculo'
              )}
            </dd>
          </div>
          <div>
            <dt>Bateria</dt>
            <dd>
              {device.battery_level === null
                ? 'Sem telemetria'
                : `${device.battery_level}%`}
            </dd>
          </div>
          <div>
            <dt>Rede</dt>
            <dd>
              {device.network_connected === null
                ? 'Sem telemetria'
                : device.network_connected
                  ? 'Conectada'
                  : 'Desconectada'}
            </dd>
          </div>
          <div>
            <dt>GPS</dt>
            <dd>
              {device.gps_available === null
                ? 'Sem telemetria'
                : device.gps_available
                  ? 'Disponível'
                  : 'Indisponível'}
            </dd>
          </div>
          <div>
            <dt>Versão</dt>
            <dd>
              {device.heartbeat_app_version ??
                device.app_version ??
                'Não informada'}
            </dd>
          </div>
          <div>
            <dt>Localização</dt>
            <dd>
              {device.latitude === null
                ? 'Não registrada'
                : `${Number(device.latitude).toFixed(5)}, ${Number(device.longitude).toFixed(5)}`}
            </dd>
          </div>
          <div>
            <dt>Armazenamento</dt>
            <dd>
              {device.storage_free_bytes === null
                ? 'Não informado'
                : `${(Number(device.storage_free_bytes) / 1_000_000_000).toFixed(1)} GB livres`}
            </dd>
          </div>
        </dl>
      </SectionCard>
      {canSimulate && (
        <SectionCard
          title="Simulador de heartbeat"
          subtitle="Ferramenta local; o banco exige superadministrador."
        >
          <form action={simulateHeartbeat} className="heartbeat-form">
            <input type="hidden" name="deviceId" value={id} />
            <label>
              Bateria
              <input
                name="batteryLevel"
                type="number"
                min={0}
                max={100}
                defaultValue={85}
              />
            </label>
            <label>
              Rede
              <select name="networkConnected" defaultValue="true">
                <option value="true">Conectada</option>
                <option value="false">Desconectada</option>
              </select>
            </label>
            <label>
              GPS
              <select name="gpsAvailable" defaultValue="true">
                <option value="true">Disponível</option>
                <option value="false">Indisponível</option>
              </select>
            </label>
            <label>
              Latitude
              <input
                name="latitude"
                type="number"
                step="any"
                defaultValue={-20.4697}
              />
            </label>
            <label>
              Longitude
              <input
                name="longitude"
                type="number"
                step="any"
                defaultValue={-54.6201}
              />
            </label>
            <button className="button button-secondary" type="submit">
              Simular heartbeat
            </button>
          </form>
        </SectionCard>
      )}
      <SectionCard
        title="Histórico de heartbeats"
        subtitle="Últimos 20 sinais persistidos"
      >
        {device.heartbeats.length === 0 ? (
          <p className="section-empty">
            Este dispositivo ainda não enviou heartbeat.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Registrado em</th>
                  <th>Bateria</th>
                  <th>Rede</th>
                  <th>GPS</th>
                  <th>Versão</th>
                </tr>
              </thead>
              <tbody>
                {device.heartbeats.map((heartbeat) => (
                  <tr key={heartbeat.id}>
                    <td>{formatDateTime(heartbeat.recorded_at)}</td>
                    <td>
                      {heartbeat.battery_level === null
                        ? '—'
                        : `${heartbeat.battery_level}%`}
                    </td>
                    <td>
                      {heartbeat.network_connected
                        ? 'Conectada'
                        : 'Desconectada'}
                    </td>
                    <td>
                      {heartbeat.gps_available ? 'Disponível' : 'Indisponível'}
                    </td>
                    <td>{heartbeat.app_version ?? '—'}</td>
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
