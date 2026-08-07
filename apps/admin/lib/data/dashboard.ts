import 'server-only';
import { listDevices } from '@/lib/data/devices';
import { createClient } from '@/lib/supabase/server';
import { humanizeAuditAction } from '@/lib/audit-labels';

export interface RecentActivityItem {
  id: string;
  kind: 'audit' | 'geo';
  label: string;
  detail: string | null;
  occurredAt: string;
}

export async function getDashboardCounts() {
  const supabase = await createClient();
  const [
    { count: advertisers, error: advertisersError },
    { count: establishments, error: establishmentsError },
    { count: activeCampaigns, error: activeError },
    { count: geoCampaigns, error: geoError },
    { count: activeDrivers, error: driversError },
    { count: activeVehicles, error: vehiclesError },
    { count: campaigns, error: campaignsError },
    { count: creatives, error: creativesError },
    { count: programmedCampaigns, error: playlistError },
    fleet,
    { data: recentAudit },
    { data: recentGeo },
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
    supabase.from('campaigns').select('*', { count: 'exact', head: true }),
    supabase
      .from('campaign_creatives')
      .select('*', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('playlist_items')
      .select('*', { count: 'exact', head: true })
      .eq('active', true),
    listDevices(),
    supabase
      .from('audit_events')
      .select('id, action, entity_type, entity_label, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('geofence_events')
      .select('id, occurred_at, campaign_geofences(campaigns(name), establishments(name))')
      .eq('event_type', 'enter')
      .order('occurred_at', { ascending: false })
      .limit(5),
  ]);
  const error =
    advertisersError ??
    establishmentsError ??
    activeError ??
    geoError ??
    driversError ??
    vehiclesError ??
    campaignsError ??
    creativesError ??
    playlistError;
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
    playerState: device.player_state,
    mediaReadyCount: device.media_ready_count,
    operationalStatus: device.operational_status,
    lastError: device.last_error,
    currentCampaignId: device.current_campaign_id,
  }));

  const playing = monitoredDevices.filter(
    (device) => device.playerState === 'playing_confirmed',
  );
  const fallback = monitoredDevices.filter(
    (device) => device.playerState === 'no_ready_media',
  );
  const attention = monitoredDevices.filter(
    (device) =>
      device.connection === 'attention' ||
      device.playerState === 'stalled' ||
      device.playerState === 'media_error',
  );

  const activity: RecentActivityItem[] = [
    ...(recentAudit ?? []).map((event) => ({
      id: `audit-${event.id}`,
      kind: 'audit' as const,
      label: humanizeAuditAction(event.action),
      detail: event.entity_label,
      occurredAt: event.created_at,
    })),
    ...(recentGeo ?? []).map((event) => ({
      id: `geo-${event.id}`,
      kind: 'geo' as const,
      label: 'Campanha GEO ativada',
      detail:
        event.campaign_geofences?.campaigns?.name &&
        event.campaign_geofences?.establishments?.name
          ? `${event.campaign_geofences.campaigns.name} em ${event.campaign_geofences.establishments.name}`
          : (event.campaign_geofences?.campaigns?.name ?? null),
      occurredAt: event.occurred_at,
    })),
  ]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 6);

  return {
    advertisers: advertisers ?? 0,
    establishments: establishments ?? 0,
    activeCampaigns: activeCampaigns ?? 0,
    geoCampaigns: geoCampaigns ?? 0,
    activeDrivers: activeDrivers ?? 0,
    activeVehicles: activeVehicles ?? 0,
    campaigns: campaigns ?? 0,
    creatives: creatives ?? 0,
    programmedCampaigns: programmedCampaigns ?? 0,
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
      playing: playing.length,
      fallback: fallback.length,
      needsAttention: attention.length + fallback.length,
    },
    playingNow: playing.slice(0, 3),
    recentActivity: activity,
  };
}
