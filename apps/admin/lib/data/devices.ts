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
      .select(
        '*, vehicles(internal_code, license_plate, driver_id, drivers(full_name))',
      )
      .order('device_code'),
    supabase
      .from('device_heartbeats')
      .select(
        'id, device_id, recorded_at, battery_level, network_connected, gps_available, storage_free_bytes, app_version, location',
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
      ...coordinates,
      connection_status: getDeviceConnectionStatus(
        heartbeat?.recorded_at ?? null,
        device.status,
      ),
    };
  });
}

export async function listDevices(search = '', connection = '', link = '') {
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
      (link !== 'unlinked' || device.vehicle_id === null),
  );
}

export async function getDevice(id: string) {
  const supabase = await createClient();
  const [devices, { data: heartbeats, error }] = await Promise.all([
    getDevicesWithLatestHeartbeats(),
    supabase
      .from('device_heartbeats')
      .select(
        'id, recorded_at, battery_level, network_connected, gps_available, storage_free_bytes, app_version',
      )
      .eq('device_id', id)
      .order('recorded_at', { ascending: false })
      .limit(20),
  ]);
  if (error) throw error;
  const device = devices.find((item) => item.id === id);
  return device ? { ...device, heartbeats } : null;
}
