import 'server-only';
import { listDevices } from '@/lib/data/devices';
import { createClient } from '@/lib/supabase/server';

export async function getDashboardCounts() {
  const supabase = await createClient();
  const [
    { count: advertisers, error: advertisersError },
    { count: establishments, error: establishmentsError },
    { count: activeCampaigns, error: activeError },
    { count: geoCampaigns, error: geoError },
    { count: activeDrivers, error: driversError },
    { count: activeVehicles, error: vehiclesError },
    fleet,
  ] = await Promise.all([
    supabase.from('advertisers').select('*', { count: 'exact', head: true }),
    supabase.from('establishments').select('*', { count: 'exact', head: true }),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_type', 'geo'),
    supabase
      .from('drivers')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    listDevices(),
  ]);
  const error =
    advertisersError ??
    establishmentsError ??
    activeError ??
    geoError ??
    driversError ??
    vehiclesError;
  if (error) throw error;
  const monitoredDevices = fleet.map((device) => ({
    id: device.id,
    code: device.device_code,
    vehicleCode: device.vehicle_code,
    driverName: device.driver_name,
    heartbeatAt: device.heartbeat_at,
    batteryLevel: device.battery_level,
    networkConnected: device.network_connected,
    gpsAvailable: device.gps_available,
    connection: device.connection_status,
  }));
  return {
    advertisers: advertisers ?? 0,
    establishments: establishments ?? 0,
    activeCampaigns: activeCampaigns ?? 0,
    geoCampaigns: geoCampaigns ?? 0,
    activeDrivers: activeDrivers ?? 0,
    activeVehicles: activeVehicles ?? 0,
    devices: monitoredDevices,
    deviceCounts: {
      total: monitoredDevices.length,
      online: monitoredDevices.filter(
        (device) => device.connection === 'online',
      ).length,
      attention: monitoredDevices.filter(
        (device) => device.connection === 'attention',
      ).length,
      offline: monitoredDevices.filter(
        (device) => device.connection === 'offline',
      ).length,
    },
  };
}
