import Link from 'next/link';
import { notFound } from 'next/navigation';
import { simulateHeartbeat } from '../actions';
import { issueDeviceCommand } from '../command-actions';
import {
  generateEnrollmentCode,
  revokeDeviceCredential,
  revokePendingEnrollmentCode,
} from '../enrollment-actions';
import {
  archiveDevice,
  deleteDevicePermanently,
  restoreDevice,
  setDeviceActive,
  unlinkDeviceVehicle,
} from '../lifecycle-actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DeviceEnrollmentPanel } from '@/components/device-enrollment-panel';
import { FleetLifecycleActions } from '@/components/fleet-lifecycle-actions';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import {
  getDevice,
  getDeviceEnrollment,
  listDeviceCommands,
} from '@/lib/data/devices';
import {
  CONNECTION_LABEL,
  formatDateTime,
  formatRelativeTime,
} from '@/lib/fleet';
import type { DeviceCommandType } from '@maxcar/shared';

const OPERATIONAL_STATUS_LABEL: Record<string, string> = {
  ready: 'Pronto',
  playing: 'Reproduzindo',
  offline_playing: 'Reproduzindo offline',
  syncing: 'Sincronizando',
  downloading: 'Baixando mídia',
  no_content: 'Sem conteúdo',
  error: 'Erro',
  maintenance: 'Manutenção',
};

const COMMAND_LABEL: Record<DeviceCommandType, string> = {
  sync_now: 'Sincronizar agora',
  restart_player: 'Reiniciar player',
  clear_obsolete_media: 'Limpar mídia obsoleta',
  enter_maintenance: 'Entrar em manutenção',
  exit_maintenance: 'Sair da manutenção',
  update_config: 'Atualizar configuração',
};

const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  delivered: 'Entregue',
  completed: 'Concluído',
  failed: 'Falhou',
  expired: 'Expirado',
};

// Same threshold as MediaDownloadManager.SEVERE_CLOCK_SKEW_SECONDS on
// Android: below this the tablet's own clock is trusted for local expiry
// enforcement; at or above it, only ever an alert here, never silent.
const SEVERE_CLOCK_SKEW_SECONDS = 3600;

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
  const canManage = !!auth && canManageFleet(auth.profile.role);
  const enrollment = canManage ? await getDeviceEnrollment(id) : null;
  const commands = canManage ? await listDeviceCommands(id) : [];
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
      <SectionCard
        title="GPS / GEO"
        subtitle="Estado do motor de geolocalização (MAX-008) no heartbeat mais recente."
      >
        <dl className="detail-grid">
          <div>
            <dt>Permissão de localização</dt>
            <dd>
              {device.location_permission_granted === null
                ? 'Sem telemetria'
                : device.location_permission_granted
                  ? 'Concedida'
                  : 'Negada'}
            </dd>
          </div>
          <div>
            <dt>Precisão</dt>
            <dd>
              {device.location_accuracy_meters === null
                ? 'Não informada'
                : `${Number(device.location_accuracy_meters).toFixed(0)} m`}
            </dd>
          </div>
          <div>
            <dt>Última entrada em geofence</dt>
            <dd>{formatRelativeTime(device.last_geofence_entry_at)}</dd>
          </div>
          <div>
            <dt>Última campanha GEO exibida</dt>
            <dd>{device.lastGeoCampaignName ?? 'Nenhuma'}</dd>
          </div>
          <div>
            <dt>Último erro de localização</dt>
            <dd>{device.last_location_error ?? 'Nenhum'}</dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard
        title="Player"
        subtitle="Estado reportado no heartbeat mais recente que incluiu telemetria de player."
      >
        <dl className="detail-grid">
          <div>
            <dt>Estado</dt>
            <dd>
              {device.player_state ? (
                <StatusBadge value={device.player_state} />
              ) : (
                'Sem telemetria de player ainda'
              )}
            </dd>
          </div>
          <div>
            <dt>Mídias prontas</dt>
            <dd>
              {device.media_ready_count === null
                ? 'Não informado'
                : device.media_ready_count}
            </dd>
          </div>
          <div>
            <dt>Versão do manifesto</dt>
            <dd>{device.manifest_version ?? 'Não sincronizado'}</dd>
          </div>
          <div>
            <dt>Última sincronização da grade</dt>
            <dd>{formatRelativeTime(device.manifest_synced_at)}</dd>
          </div>
          <div>
            <dt>Último criativo reproduzido</dt>
            <dd>{device.currentCreativeName ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Campanha atual</dt>
            <dd>{device.currentCampaignName ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Último erro do player</dt>
            <dd>{device.last_error ?? 'Nenhum'}</dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard
        title="Sincronização"
        subtitle="Estado do Motor de Sincronização (MAX-009) no heartbeat mais recente."
      >
        <dl className="detail-grid">
          <div>
            <dt>Status operacional</dt>
            <dd>
              {device.operational_status ? (
                <StatusBadge
                  value={
                    OPERATIONAL_STATUS_LABEL[device.operational_status] ??
                    device.operational_status
                  }
                />
              ) : (
                'Sem telemetria'
              )}
            </dd>
          </div>
          <div>
            <dt>Fila de eventos pendentes</dt>
            <dd>
              {device.pending_event_count === null
                ? 'Não informado'
                : device.pending_event_count}
            </dd>
          </div>
          <div>
            <dt>Divergência de relógio</dt>
            <dd>
              {device.clock_skew_seconds === null ? (
                'Não informada'
              ) : Math.abs(device.clock_skew_seconds) >=
                SEVERE_CLOCK_SKEW_SECONDS ? (
                <StatusBadge
                  value={`Atenção: ${device.clock_skew_seconds}s de diferença`}
                />
              ) : (
                `${device.clock_skew_seconds}s`
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>
      {canManage && (
        <SectionCard
          title="Comandos remotos"
          subtitle="Conjunto fechado de operações seguras — nunca shell arbitrário. Entregue no próximo ciclo de sincronização do tablet."
        >
          <div className="lifecycle-actions-row">
            {(Object.keys(COMMAND_LABEL) as DeviceCommandType[]).map(
              (commandType) => (
                <form
                  key={commandType}
                  action={issueDeviceCommand.bind(null, id)}
                >
                  <input type="hidden" name="commandType" value={commandType} />
                  <button className="button button-secondary" type="submit">
                    {COMMAND_LABEL[commandType]}
                  </button>
                </form>
              ),
            )}
          </div>
          {commands.length === 0 ? (
            <p className="section-empty">Nenhum comando enviado ainda.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Comando</th>
                    <th>Status</th>
                    <th>Enviado em</th>
                    <th>Entregue em</th>
                    <th>Concluído em</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((command) => (
                    <tr key={command.id}>
                      <td>{COMMAND_LABEL[command.command_type]}</td>
                      <td>
                        <StatusBadge
                          value={
                            COMMAND_STATUS_LABEL[command.status] ??
                            command.status
                          }
                        />
                      </td>
                      <td>{formatDateTime(command.created_at)}</td>
                      <td>{formatDateTime(command.delivered_at)}</td>
                      <td>{formatDateTime(command.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
      {canManage && enrollment && (
        <SectionCard
          title="Ativação do tablet"
          subtitle="Código de uso único para vincular o hardware físico a este dispositivo."
        >
          <DeviceEnrollmentPanel
            isEnrolled={enrollment.is_enrolled ?? false}
            pendingCodeExpiresAt={enrollment.pending_code_expires_at}
            credentialIssuedAt={enrollment.credential_issued_at}
            credentialLastUsedAt={enrollment.credential_last_used_at}
            generateAction={generateEnrollmentCode.bind(null, id)}
            revokeCodeAction={revokePendingEnrollmentCode.bind(null, id)}
            revokeCredentialAction={revokeDeviceCredential.bind(null, id)}
          />
        </SectionCard>
      )}
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
      {canManage && (
        <SectionCard
          title="Ciclo de vida"
          subtitle="Desativar, arquivar e excluir são ações distintas — veja docs/admin/FLEET_LIFECYCLE.md."
        >
          <FleetLifecycleActions
            entityLabel="dispositivo"
            entityDisplayName={device.device_code}
            isArchived={Boolean(device.archived_at)}
            isActive={device.status !== 'maintenance'}
            isSuperAdmin={auth?.profile.role === 'super_admin'}
            canUnlink={Boolean(device.vehicle_id)}
            unlinkLabel="o veículo"
            archiveAction={archiveDevice.bind(null, id)}
            restoreAction={restoreDevice.bind(null, id)}
            setActiveAction={setDeviceActive.bind(null, id)}
            unlinkAction={unlinkDeviceVehicle.bind(null, id)}
            deleteAction={deleteDevicePermanently.bind(null, id)}
          />
        </SectionCard>
      )}
    </div>
  );
}
