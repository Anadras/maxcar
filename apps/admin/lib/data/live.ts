import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { classifyLiveStatus, type LiveStatus } from '@/lib/fleet';
import { getDevicesWithLatestHeartbeats } from './devices';
import { listDefaultPlaylistCampaigns } from './campaigns';

export type { LiveStatus };

export interface LiveDevice {
  id: string;
  deviceCode: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  driverName: string | null;
  connectionStatus: string;
  liveStatus: LiveStatus;
  playerState: string | null;
  heartbeatAt: string | null;
  appVersion: string | null;
  batteryLevel: number | null;
  networkConnected: boolean | null;
  gpsAvailable: boolean | null;
  currentCampaignId: string | null;
  currentCampaignName: string | null;
  currentCreativeName: string | null;
  currentCreativeType: string | null;
  nextCampaignName: string | null;
  manifestVersion: string | null;
  manifestSyncedAt: string | null;
  quarantinedMediaCount: number | null;
  pendingEventCount: number | null;
  kioskLevel: string | null;
  lastError: string | null;
  geo: {
    campaignName: string | null;
    priority: number | null;
    playbackMode: string | null;
    geofenceName: string | null;
    detectedAt: string | null;
    firstFrameAt: string | null;
    latencySeconds: number | null;
  } | null;
}

const classify = classifyLiveStatus;

export async function listLiveDevices(): Promise<LiveDevice[]> {
  const supabase = await createClient();
  const [devices, orderedRegular] = await Promise.all([
    getDevicesWithLatestHeartbeats(),
    listDefaultPlaylistCampaigns(),
  ]);

  const nextByCampaignId = new Map<string, string>();
  orderedRegular.forEach((campaign, index) => {
    const next = orderedRegular[(index + 1) % orderedRegular.length];
    if (next) nextByCampaignId.set(campaign.campaignId, next.name);
  });

  const campaignIds = Array.from(
    new Set(
      devices.flatMap((device) =>
        [device.current_campaign_id, device.last_geo_campaign_id].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
  );
  const creativeIds = Array.from(
    new Set(
      devices
        .map((device) => device.current_creative_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [{ data: campaigns }, { data: creatives }] = await Promise.all([
    campaignIds.length
      ? supabase
          .from('campaigns')
          .select('id, name, priority, playback_mode')
          .in('id', campaignIds)
      : Promise.resolve({ data: [] as never[] }),
    creativeIds.length
      ? supabase
          .from('campaign_creatives')
          .select('id, name, creative_type')
          .in('id', creativeIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const campaignById = new Map((campaigns ?? []).map((row) => [row.id, row]));
  const creativeById = new Map((creatives ?? []).map((row) => [row.id, row]));

  // Most recent geofence "enter" per device with an active GEO campaign
  // right now — batched in one query rather than one round-trip per
  // device. Only devices currently classified as 'geo' need this.
  const geoDeviceIds = devices
    .filter((device) => classify(device) === 'geo')
    .map((device) => device.id);
  const geoEventByDevice = new Map<
    string,
    { occurred_at: string; establishment_name: string | null }
  >();
  const firstFrameByDevice = new Map<string, string>();
  if (geoDeviceIds.length) {
    const { data: events } = await supabase
      .from('geofence_events')
      .select(
        'device_id, occurred_at, campaign_geofences(geofences(establishments(name)))',
      )
      .in('device_id', geoDeviceIds)
      .eq('event_type', 'enter')
      .order('occurred_at', { ascending: false });
    for (const event of events ?? []) {
      if (!geoEventByDevice.has(event.device_id)) {
        geoEventByDevice.set(event.device_id, {
          occurred_at: event.occurred_at,
          establishment_name:
            event.campaign_geofences?.geofences?.establishments?.name ??
            null,
        });
      }
    }
    const { data: impressions } = await supabase
      .from('impressions')
      .select('device_id, started_at')
      .in('device_id', geoDeviceIds)
      .eq('source', 'geo')
      .order('started_at', { ascending: false });
    for (const impression of impressions ?? []) {
      if (!firstFrameByDevice.has(impression.device_id)) {
        firstFrameByDevice.set(impression.device_id, impression.started_at);
      }
    }
  }

  return devices.map((device) => {
    const liveStatus = classify(device);
    const currentCampaign = device.current_campaign_id
      ? campaignById.get(device.current_campaign_id)
      : null;
    const currentCreative = device.current_creative_id
      ? creativeById.get(device.current_creative_id)
      : null;
    const geoCampaign = device.last_geo_campaign_id
      ? campaignById.get(device.last_geo_campaign_id)
      : null;
    const geoEvent = geoEventByDevice.get(device.id);
    const firstFrame = firstFrameByDevice.get(device.id);
    const latencySeconds =
      geoEvent && firstFrame
        ? Math.max(
            0,
            Math.round(
              (new Date(firstFrame).getTime() -
                new Date(geoEvent.occurred_at).getTime()) /
                1000,
            ),
          )
        : null;

    return {
      id: device.id,
      deviceCode: device.device_code,
      vehicleCode: device.vehicle_code,
      licensePlate: device.license_plate,
      driverName: device.driver_name,
      connectionStatus: device.connection_status,
      liveStatus,
      playerState: device.player_state,
      heartbeatAt: device.heartbeat_at,
      appVersion: device.heartbeat_app_version,
      batteryLevel: device.battery_level,
      networkConnected: device.network_connected,
      gpsAvailable: device.gps_available,
      currentCampaignId: device.current_campaign_id,
      currentCampaignName: currentCampaign?.name ?? null,
      currentCreativeName: currentCreative?.name ?? null,
      currentCreativeType: currentCreative?.creative_type ?? null,
      nextCampaignName:
        liveStatus === 'playing' && device.current_campaign_id
          ? (nextByCampaignId.get(device.current_campaign_id) ?? null)
          : null,
      manifestVersion: device.manifest_version,
      manifestSyncedAt: device.manifest_synced_at,
      quarantinedMediaCount: device.quarantined_media_count,
      pendingEventCount: device.pending_event_count,
      kioskLevel: device.kiosk_level,
      lastError: device.last_error,
      geo:
        liveStatus === 'geo'
          ? {
              campaignName: geoCampaign?.name ?? null,
              priority: geoCampaign?.priority ?? null,
              playbackMode: geoCampaign?.playback_mode ?? null,
              geofenceName: geoEvent?.establishment_name ?? null,
              detectedAt: geoEvent?.occurred_at ?? null,
              firstFrameAt: firstFrame ?? null,
              latencySeconds,
            }
          : null,
    };
  });
}
