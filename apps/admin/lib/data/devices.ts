import 'server-only';
import { getDeviceConnectionStatus } from '@maxcar/business-rules';
import { createClient } from '@/lib/supabase/server';

function coordinatesFromLocation(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'coordinates' in value &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 &&
    value.coordinates.every((coordinate) => typeof coordinate === 'number')
  ) {
    return {
      longitude: value.coordinates[0] as number,
      latitude: value.coordinates[1] as number,
    };
  }
  return { longitude: null, latitude: null };
}

async function getDevicesWithLatestHeartbeats() {
  const supabase = await createClient();
  const [
    { data: devices, error },
    { data: heartbeats, error: heartbeatError },
  ] = await Promise.all([
    supabase
      .from('devices')
      // Explicit column list — never `*` — so a new sensitive column
      // (maintenance_pin_hash/salt, MAX-010) never accidentally starts
      // flowing through this shared query by default.
      .select(
        'id, vehicle_id, device_code, status, app_version, last_seen_at, last_sync_at, created_at, updated_at, archived_at, vehicles(internal_code, license_plate, driver_id, drivers(full_name))',
      )
      .order('device_code'),
    supabase
      .from('device_heartbeats')
      .select(
        'id, device_id, recorded_at, battery_level, network_connected, gps_available, storage_free_bytes, app_version, location, player_state, media_ready_count, manifest_version, current_campaign_id, current_creative_id, last_error, location_accuracy_meters, location_permission_granted, last_location_error, last_geofence_entry_at, last_geo_campaign_id, operational_status, pending_event_count, clock_skew_seconds, kiosk_level, quarantined_media_count',
      )
      .order('recorded_at', { ascending: false }),
  ]);
  if (error) throw error;
  if (heartbeatError) throw heartbeatError;

  const latest = new Map<string, (typeof heartbeats)[number] | undefined>();
  for (const heartbeat of heartbeats) {
    if (!latest.has(heartbeat.device_id)) {
      latest.set(heartbeat.device_id, heartbeat);
    }
  }
  return devices.map((device) => {
    const heartbeat = latest.get(device.id);
    const coordinates = coordinatesFromLocation(heartbeat?.location);
    return {
      ...device,
      vehicle_code: device.vehicles?.internal_code ?? null,
      license_plate: device.vehicles?.license_plate ?? null,
      driver_id: device.vehicles?.driver_id ?? null,
      driver_name: device.vehicles?.drivers?.full_name ?? null,
      heartbeat_at: heartbeat?.recorded_at ?? null,
      battery_level: heartbeat?.battery_level ?? null,
      network_connected: heartbeat?.network_connected ?? null,
      gps_available: heartbeat?.gps_available ?? null,
      storage_free_bytes: heartbeat?.storage_free_bytes ?? null,
      heartbeat_app_version: heartbeat?.app_version ?? null,
      player_state: heartbeat?.player_state ?? null,
      media_ready_count: heartbeat?.media_ready_count ?? null,
      manifest_version: heartbeat?.manifest_version ?? null,
      current_campaign_id: heartbeat?.current_campaign_id ?? null,
      current_creative_id: heartbeat?.current_creative_id ?? null,
      last_error: heartbeat?.last_error ?? null,
      location_accuracy_meters: heartbeat?.location_accuracy_meters ?? null,
      location_permission_granted:
        heartbeat?.location_permission_granted ?? null,
      last_location_error: heartbeat?.last_location_error ?? null,
      last_geofence_entry_at: heartbeat?.last_geofence_entry_at ?? null,
      last_geo_campaign_id: heartbeat?.last_geo_campaign_id ?? null,
      operational_status: heartbeat?.operational_status ?? null,
      pending_event_count: heartbeat?.pending_event_count ?? null,
      clock_skew_seconds: heartbeat?.clock_skew_seconds ?? null,
      kiosk_level: heartbeat?.kiosk_level ?? null,
      quarantined_media_count: heartbeat?.quarantined_media_count ?? null,
      manifest_synced_at: heartbeat?.manifest_version
        ? (heartbeat?.recorded_at ?? null)
        : null,
      ...coordinates,
      connection_status: getDeviceConnectionStatus(
        heartbeat?.recorded_at ?? null,
        device.status,
      ),
    };
  });
}

export async function listDevices(
  search = '',
  connection = '',
  link = '',
  archived: 'active' | 'archived' | 'all' = 'active',
  playerState = '',
) {
  const devices = await getDevicesWithLatestHeartbeats();
  const term = search.trim().toLowerCase();
  return devices.filter(
    (device) =>
      (!term ||
        [
          device.device_code,
          device.vehicle_code,
          device.license_plate,
          device.driver_name,
        ].some((value) => value?.toLowerCase().includes(term))) &&
      (!connection || device.connection_status === connection) &&
      (link !== 'linked' || device.vehicle_id !== null) &&
      (link !== 'unlinked' || device.vehicle_id === null) &&
      (archived !== 'active' || device.archived_at === null) &&
      (archived !== 'archived' || device.archived_at !== null) &&
      (!playerState || device.player_state === playerState),
  );
}

export async function getDevice(id: string) {
  const supabase = await createClient();
  const [devices, { data: heartbeats, error }, { data: pinRow }] =
    await Promise.all([
      getDevicesWithLatestHeartbeats(),
      supabase
        .from('device_heartbeats')
        .select(
          'id, recorded_at, battery_level, network_connected, gps_available, storage_free_bytes, app_version',
        )
        .eq('device_id', id)
        .order('recorded_at', { ascending: false })
        .limit(20),
      // Only ever a boolean reaches the rest of the app — the hash/salt
      // themselves are never selected outside set_device_maintenance_pin's
      // own RPC boundary. maintenance_timeout_seconds isn't secret (unlike
      // the PIN hash) so it's fine to read and echo back in the form.
      supabase
        .from('devices')
        .select('maintenance_pin_hash, maintenance_timeout_seconds')
        .eq('id', id)
        .maybeSingle(),
    ]);
  if (error) throw error;
  const device = devices.find((item) => item.id === id);
  if (!device) return null;
  const maintenancePinConfigured = pinRow?.maintenance_pin_hash != null;
  const maintenanceTimeoutSeconds = pinRow?.maintenance_timeout_seconds ?? null;

  let currentCampaignName: string | null = null;
  let currentCreativeName: string | null = null;
  if (device.current_campaign_id) {
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('name')
      .eq('id', device.current_campaign_id)
      .maybeSingle();
    currentCampaignName = campaign?.name ?? null;
  }
  if (device.current_creative_id) {
    const { data: creative } = await supabase
      .from('campaign_creatives')
      .select('name')
      .eq('id', device.current_creative_id)
      .maybeSingle();
    currentCreativeName = creative?.name ?? null;
  }

  let lastGeoCampaignName: string | null = null;
  if (device.last_geo_campaign_id) {
    const { data: geoCampaign } = await supabase
      .from('campaigns')
      .select('name')
      .eq('id', device.last_geo_campaign_id)
      .maybeSingle();
    lastGeoCampaignName = geoCampaign?.name ?? null;
  }

  return {
    ...device,
    heartbeats,
    currentCampaignName,
    currentCreativeName,
    lastGeoCampaignName,
    maintenancePinConfigured,
    maintenanceTimeoutSeconds,
  };
}

export async function getDeviceEnrollment(deviceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('device_enrollment_admin_view')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** MAX-010.6: the tablet's cryptographic identity (never the v1 static
 * token this replaces). Only the non-secret fingerprint/metadata is ever
 * selected here — the public key DER itself isn't exposed to this view at
 * all, and there is no column anywhere that could leak a private key. */
export async function getDeviceKeyIdentity(deviceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('device_key_admin_view')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const COMMAND_SELECT =
  'id, command_type, status, created_at, delivered_at, completed_at, result';

/** Bloco 8: the panel never dumps the raw table — an operator only ever
 * needs to know "is something in flight right now" and "what happened
 * recently"; anything older belongs on the dedicated history page
 * (listDeviceCommandHistory), not cluttering the device screen. */
export async function listDeviceCommandsSummary(deviceId: string) {
  const supabase = await createClient();
  const [{ data: current, error: currentError }, { data: recent, error: recentError }] =
    await Promise.all([
      supabase
        .from('device_commands')
        .select(COMMAND_SELECT)
        .eq('device_id', deviceId)
        .in('status', ['pending', 'delivered'])
        .order('created_at', { ascending: false }),
      supabase
        .from('device_commands')
        .select(COMMAND_SELECT)
        .eq('device_id', deviceId)
        .in('status', ['completed', 'failed', 'expired'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(5),
    ]);
  if (currentError) throw currentError;
  if (recentError) throw recentError;
  return { current: current ?? [], recent: recent ?? [] };
}

export async function listDeviceCommandHistory(deviceId: string, limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('device_commands')
    .select(COMMAND_SELECT)
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
