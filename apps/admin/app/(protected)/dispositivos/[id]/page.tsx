import Link from 'next/link';
import { notFound } from 'next/navigation';
import { simulateHeartbeat } from '../actions';
import { issueDeviceCommand } from '../command-actions';
import {
  generateEnrollmentCode,
  revokeDeviceCredential,
  revokeDeviceKeyIdentity,
  revokePendingEnrollmentCode,
} from '../enrollment-actions';
import {
  archiveDevice,
  deleteDevicePermanently,
  restoreDevice,
  setDeviceActive,
  unlinkDeviceVehicle,
} from '../lifecycle-actions';
import {
  generateDeviceMaintenanceTempCode,
  setDeviceMaintenancePin,
  setDeviceMaintenanceTimeout,
} from '../pin-actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DeviceEnrollmentPanel } from '@/components/device-enrollment-panel';
import { DeviceKeyIdentityPanel } from '@/components/device-key-identity-panel';
import { FleetLifecycleActions } from '@/components/fleet-lifecycle-actions';
import { FlashMessage } from '@/components/flash-message';
import { MaintenanceTempCodeForm } from '@/components/maintenance-temp-code-form';
import {
  PageHeader,
  PlayerStateBadge,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import {
  getDevice,
  getDeviceEnrollment,
  getDeviceKeyIdentity,
  listDeviceCommandsSummary,
} from '@/lib/data/devices';
import {
  CONNECTION_LABEL,
  PLAYER_STATE_LABEL,
  formatDateTime,
  formatRelativeTime,
} from '@/lib/fleet';
import type { DeviceCommandType } from '@maxcar/shared';

// device.status is an administrative lifecycle field (provisioning/
// maintenance/retired/etc.), not live connectivity — the enum happens to
// also use the words "online"/"offline", which read as current
// connection state if shown unlabeled next to "Conexão" (the real,
// heartbeat-age-based field). Distinct label + wording rules that out.
const DEVICE_LIFECYCLE_LABEL: Record<string, string> = {
  provisioning: 'Em provisionamento',
  online: 'Em operação',
  offline: 'Fora de operação (manual)',
  maintenance: 'Em manutenção',
  retired: 'Aposentado',
};

const OPERATIONAL_STATUS_LABEL: Record<string, string> = {
  ready: 'Pronto',
  playing: 'Reproduzindo',
  offline_playing: 'Reproduzindo offline',
  syncing: 'Sincronizando',
  downloading: 'Baixando mídia',
  no_content: 'Sem conteúdo',
  // MAX-012: the watchdog surfaces these two distinctly instead of the
  // tablet just silently looking "stuck" — see playbackDiagnosis below.
  recovering: 'Recuperando de uma falha de mídia',
  media_error: 'Erro de mídia',
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
  enable_kiosk: 'Ativar quiosque',
  disable_kiosk_temporarily: 'Suspender quiosque temporariamente',
  reenter_kiosk: 'Retomar quiosque agora',
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

const KIOSK_LEVEL_LABEL: Record<string, string> = {
  none: 'Nenhum (tela normal)',
  immersive: 'Imersivo (tela cheia)',
  lock_task: 'Fixação de tela (Lock Task)',
  device_owner: 'Device Owner (bloqueio profissional)',
};

// MAX-012 item 14: reads the player's own richer state instead of
// collapsing everything down to "not exactly 'playing'" — that old check
// couldn't tell a genuinely broken tablet apart from one mid-buffer for a
// second, and never told the operator when the watchdog itself was already
// handling a bad file (never "success", but never a false alarm either).
function playbackDiagnosis(device: {
  connection_status: string;
  player_state: string | null;
  media_ready_count: number | null;
  manifest_version: string | null;
  last_error: string | null;
  quarantined_media_count: number | null;
}) {
  if (device.connection_status === 'offline') {
    return {
      tone: 'attention',
      title: 'Tablet sem contato com o painel',
      message:
        'A programação que já estiver salva continua funcionando, mas novas campanhas não chegam até a conexão voltar.',
    };
  }
  if ((device.media_ready_count ?? 0) === 0) {
    return {
      tone: 'attention',
      title: 'Nenhum conteúdo pronto para reproduzir',
      message: device.manifest_version
        ? 'O tablet sincronizou, mas não encontrou campanha ativa e publicada para baixar.'
        : 'O tablet ainda não recebeu sua primeira programação.',
    };
  }
  if (
    device.player_state === 'stalled' ||
    device.player_state === 'recovering'
  ) {
    return {
      tone: 'attention',
      title: 'O player está recuperando de uma falha de mídia',
      message:
        'O watchdog do tablet detectou uma trava e está avançando sozinho para o próximo conteúdo válido — normalmente resolve em segundos, sem precisar de ação aqui.',
    };
  }
  if (device.player_state === 'media_error' || device.last_error) {
    return {
      tone: 'danger',
      title: 'O tablet encontrou um erro ao preparar a mídia',
      message:
        'Envie uma nova sincronização. Se o problema continuar, confira o arquivo da campanha.',
    };
  }
  if (device.player_state === 'no_ready_media') {
    return {
      tone: 'attention',
      title: 'Nada elegível para tocar agora — o tablet está tentando se recuperar sozinho',
      message:
        'O app tenta automaticamente a cada 30s (uma quarentena expirando, uma nova sincronização, ou o horário/dia programado abrindo). Pode ser fora do horário/dia programado, ou toda a mídia disponível está em quarentena — veja "Mídias em quarentena" abaixo. Se persistir por muito tempo, verifique o conteúdo publicado.',
    };
  }
  if (device.player_state !== 'playing_confirmed') {
    return {
      tone: 'attention',
      title: 'Conteúdo pronto, mas o player não está reproduzindo',
      message: 'Sincronize e reinicie o player usando as ações abaixo.',
    };
  }
  if ((device.quarantined_media_count ?? 0) > 0) {
    return {
      tone: 'attention',
      title: 'Reproduzindo, mas com mídia em quarentena',
      message: `${device.quarantined_media_count} mídia(s) foram desativadas automaticamente após falhar repetidamente — o restante da grade continua normalmente.`,
    };
  }
  return {
    tone: 'success',
    title: 'Reprodução funcionando',
    message: `${device.media_ready_count} mídia(s) pronta(s) no tablet.`,
  };
}

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
  const keyIdentity = canManage ? await getDeviceKeyIdentity(id) : null;
  const commands = canManage
    ? await listDeviceCommandsSummary(id)
    : { current: [], recent: [] };
  const canSimulate =
    process.env.NODE_ENV !== 'production' &&
    auth?.profile.role === 'super_admin';
  const diagnosis = playbackDiagnosis(device);
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
      <section className={`device-diagnosis ${diagnosis.tone}`}>
        <div>
          <span>{diagnosis.tone === 'success' ? '✓' : '!'}</span>
          <div>
            <h2>{diagnosis.title}</h2>
            <p>{diagnosis.message}</p>
          </div>
        </div>
        {canManage && diagnosis.tone !== 'success' && (
          <form action={issueDeviceCommand.bind(null, id)}>
            <input type="hidden" name="commandType" value="sync_now" />
            <button className="button button-primary" type="submit">
              Sincronizar agora
            </button>
          </form>
        )}
      </section>
      <SectionCard title="Resumo do tablet">
        <dl className="detail-grid">
          <div>
            <dt>Conexão</dt>
            <dd>
              <StatusBadge value={CONNECTION_LABEL[device.connection_status]} />
            </dd>
          </div>
          <div>
            <dt>Etapa operacional</dt>
            <dd>
              <StatusBadge
                value={DEVICE_LIFECYCLE_LABEL[device.status] ?? device.status}
              />
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
            <dt>Última bateria informada</dt>
            <dd>
              {device.battery_level === null
                ? 'Sem telemetria'
                : `${device.battery_level}% — ${formatRelativeTime(device.heartbeat_at)}`}
            </dd>
          </div>
          <div>
            <dt>Última rede informada</dt>
            <dd>
              {device.network_connected === null
                ? 'Sem telemetria'
                : `${device.network_connected ? 'Conectada' : 'Desconectada'} — ${formatRelativeTime(device.heartbeat_at)}`}
            </dd>
          </div>
          <div>
            <dt>Último estado de GPS informado</dt>
            <dd>
              {device.gps_available === null
                ? 'Sem telemetria'
                : `${device.gps_available ? 'Disponível' : 'Indisponível'} — ${formatRelativeTime(device.heartbeat_at)}`}
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
      <details className="technical-details">
        <summary>Ver informações técnicas e manutenção</summary>
        <SectionCard
          title="GPS / GEO"
          subtitle="Localização informada pelo tablet."
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
                  <PlayerStateBadge
                    playerState={device.player_state}
                    label={
                      PLAYER_STATE_LABEL[device.player_state] ??
                      device.player_state
                    }
                  />
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
              <dt>Mídias em quarentena</dt>
              <dd>
                {device.quarantined_media_count === null
                  ? 'Não informado'
                  : device.quarantined_media_count}
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
                {device.pending_event_count === null ? (
                  'Não informado'
                ) : (
                  <>
                    {device.pending_event_count}
                    {device.pending_event_count > 0 && (
                      <>
                        {' '}
                        <span className="section-hint">
                          Eventos de geofence registrados no tablet e ainda não
                          confirmados pelo servidor. Um número que só cresce
                          indica que o tablet não está conseguindo sincronizar —
                          envie uma sincronização abaixo.
                        </span>
                        {canManage && (
                          <form
                            action={issueDeviceCommand.bind(null, id)}
                            className="inline-form"
                          >
                            <input
                              type="hidden"
                              name="commandType"
                              value="sync_now"
                            />
                            <button
                              className="button button-secondary button-small"
                              type="submit"
                            >
                              Reprocessar pendências
                            </button>
                          </form>
                        )}
                      </>
                    )}
                  </>
                )}
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
        <SectionCard
          title="Kiosk e manutenção"
          subtitle="Camada de proteção realmente alcançada pelo tablet (nunca apenas a tentada) e o PIN técnico local. Ver docs/architecture/ANDROID_KIOSK.md."
        >
          <dl className="detail-grid">
            <div>
              <dt>Camada de kiosk ativa</dt>
              <dd>
                {device.kiosk_level ? (
                  <StatusBadge
                    value={
                      KIOSK_LEVEL_LABEL[device.kiosk_level] ??
                      device.kiosk_level
                    }
                  />
                ) : (
                  'Sem telemetria'
                )}
              </dd>
            </div>
            <div>
              <dt>PIN de manutenção</dt>
              <dd>
                <StatusBadge
                  value={
                    device.maintenancePinConfigured
                      ? 'Configurado'
                      : 'Não configurado'
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Tempo de manutenção antes de retomar o quiosque</dt>
              <dd>
                {device.maintenanceTimeoutSeconds != null
                  ? `${Math.round(device.maintenanceTimeoutSeconds / 60)} min`
                  : 'Padrão do app (5 min)'}
              </dd>
            </div>
          </dl>
          {canManage && (
            <form
              action={setDeviceMaintenanceTimeout.bind(null, id)}
              className="heartbeat-form"
            >
              <label>
                Tempo até retomar o quiosque (60 a 1800 segundos)
                <input
                  name="maintenanceTimeoutSeconds"
                  type="number"
                  min={60}
                  max={1800}
                  step={30}
                  defaultValue={device.maintenanceTimeoutSeconds ?? ''}
                  placeholder="300 (padrão)"
                />
              </label>
              <button className="button button-secondary" type="submit">
                Salvar tempo de manutenção
              </button>
            </form>
          )}
          {auth?.profile.role === 'super_admin' && (
            <form
              action={setDeviceMaintenancePin.bind(null, id)}
              className="heartbeat-form"
            >
              <label>
                Novo PIN (exatamente 6 dígitos)
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Confirmar PIN
                <input
                  name="confirmPin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="off"
                  required
                />
              </label>
              <button className="button button-secondary" type="submit">
                {device.maintenancePinConfigured ? 'Trocar PIN' : 'Definir PIN'}
              </button>
            </form>
          )}
          {auth?.profile.role === 'super_admin' && (
            <MaintenanceTempCodeForm
              generateAction={generateDeviceMaintenanceTempCode.bind(null, id)}
            />
          )}
        </SectionCard>
      </details>
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
      {canManage && keyIdentity && (
        <SectionCard
          title="Autenticação do tablet"
          subtitle="Identidade criptográfica do dispositivo (MAX-010.6) — substitui o token estático por uma chave que nunca sai do tablet."
        >
          <DeviceKeyIdentityPanel
            hasActiveKey={keyIdentity.has_active_key ?? false}
            hasActiveLegacyToken={keyIdentity.has_active_legacy_token ?? false}
            algorithm={keyIdentity.algorithm}
            hardwareBacked={keyIdentity.hardware_backed}
            keyActivatedAt={keyIdentity.key_activated_at}
            keyLastUsedAt={keyIdentity.key_last_used_at}
            revokeAction={revokeDeviceKeyIdentity.bind(null, id)}
          />
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
      {(canManage || canSimulate) && (
        <details className="technical-details">
          <summary>Ferramentas avançadas</summary>
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
                      <input
                        type="hidden"
                        name="commandType"
                        value={commandType}
                      />
                      <button className="button button-secondary" type="submit">
                        {COMMAND_LABEL[commandType]}
                      </button>
                    </form>
                  ),
                )}
              </div>
              {commands.current.length === 0 && commands.recent.length === 0 ? (
                <p className="section-empty">Nenhum comando enviado ainda.</p>
              ) : (
                <>
                  {commands.current.length > 0 && (
                    <>
                      <h3 className="section-subheading">Em andamento</h3>
                      <CommandTable commands={commands.current} />
                    </>
                  )}
                  {commands.recent.length > 0 && (
                    <>
                      <h3 className="section-subheading">Últimos concluídos</h3>
                      <CommandTable commands={commands.recent} />
                    </>
                  )}
                </>
              )}
              <Link
                href={`/dispositivos/${id}/comandos`}
                className="section-link"
              >
                Ver histórico completo →
              </Link>
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
        </details>
      )}
    </div>
  );
}

type DeviceCommandRow = {
  id: string;
  command_type: DeviceCommandType;
  status: string;
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  result: unknown;
};

function CommandTable({ commands }: { commands: DeviceCommandRow[] }) {
  return (
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
                  value={COMMAND_STATUS_LABEL[command.status] ?? command.status}
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
  );
}
