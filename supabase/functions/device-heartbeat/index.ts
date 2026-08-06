// POST /functions/v1/device-heartbeat
// Header: Authorization: Bearer <device token>
// Body: { batteryLevel?, networkType?, storageFreeBytes?, appVersion?, deviceTime?, clientEventId? }
//
// The server never trusts a device-supplied device_id: the token itself is
// hashed and looked up server-side (private.device_id_for_token) to derive
// which device is reporting. deviceTime is accepted as metadata only —
// recorded_at always comes from the server clock.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-heartbeat';

interface HeartbeatBody {
  batteryLevel?: number;
  networkType?: 'wifi' | 'cellular' | 'offline';
  storageFreeBytes?: number;
  appVersion?: string;
  deviceTime?: string;
  clientEventId?: string;
  // Player-state summary, optional and additive (MAX-007).
  playerState?: string;
  mediaReadyCount?: number;
  manifestVersion?: string;
  currentCampaignId?: string;
  currentCreativeId?: string;
  lastError?: string;
  // GPS/GEO status, optional and additive (MAX-008).
  latitude?: number;
  longitude?: number;
  gpsAvailable?: boolean;
  locationAccuracyMeters?: number;
  locationPermissionGranted?: boolean;
  lastLocationError?: string;
  lastGeofenceEntryAt?: string;
  lastGeoCampaignId?: string;
  // Sync/operational status, optional and additive (MAX-009).
  operationalStatus?: string;
  pendingEventCount?: number;
  clockSkewSeconds?: number;
  // Kiosk layer actually achieved, optional and additive (MAX-010).
  kioskLevel?: string;
  // How many synced creatives are currently quarantined by the player's
  // own watchdog, optional and additive (MAX-012).
  quarantinedMediaCount?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'invalid_request', message: 'POST required.' },
      405,
    );
  }

  const rawBodyText = await req.text();
  const tokenResult = await resolveDeviceApiToken(
    req,
    new TextEncoder().encode(rawBodyText),
    FUNCTION_PATH,
  );
  if (!tokenResult.ok) return tokenResult.response;
  const token = tokenResult.token;

  let body: HeartbeatBody;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc('record_device_heartbeat', {
      p_token: token,
      p_battery_level: body.batteryLevel ?? null,
      p_network_type: body.networkType ?? 'offline',
      p_storage_free_bytes: body.storageFreeBytes ?? null,
      p_app_version: body.appVersion ?? null,
      p_device_time: body.deviceTime ?? null,
      p_client_event_id: body.clientEventId ?? null,
      p_player_state: body.playerState ?? null,
      p_media_ready_count: body.mediaReadyCount ?? null,
      p_manifest_version: body.manifestVersion ?? null,
      p_current_campaign_id: body.currentCampaignId ?? null,
      p_current_creative_id: body.currentCreativeId ?? null,
      p_last_error: body.lastError ?? null,
      p_latitude: body.latitude ?? null,
      p_longitude: body.longitude ?? null,
      p_gps_available: body.gpsAvailable ?? false,
      p_location_accuracy_meters: body.locationAccuracyMeters ?? null,
      p_location_permission_granted: body.locationPermissionGranted ?? null,
      p_last_location_error: body.lastLocationError ?? null,
      p_last_geofence_entry_at: body.lastGeofenceEntryAt ?? null,
      p_last_geo_campaign_id: body.lastGeoCampaignId ?? null,
      p_operational_status: body.operationalStatus ?? null,
      p_pending_event_count: body.pendingEventCount ?? null,
      p_clock_skew_seconds: body.clockSkewSeconds ?? null,
      p_kiosk_level: body.kioskLevel ?? null,
      p_quarantined_media_count: body.quarantinedMediaCount ?? null,
    })
    .single();

  if (error) return errorResponse(error);

  return jsonResponse({
    deviceId: data.out_device_id,
    deviceCode: data.device_code,
    recordedAt: data.recorded_at,
  });
});
