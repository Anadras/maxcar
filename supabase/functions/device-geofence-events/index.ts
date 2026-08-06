// POST /functions/v1/device-geofence-events
// Header: Authorization: Bearer <device token>
// Body: { events: [{ clientEventId, geofenceId, eventType, latitude,
//                     longitude, accuracyMeters?, distanceMeters?,
//                     occurredAt? }] }
//
// One row per Location Engine state-machine transition (OUTSIDE->ENTERED,
// INSIDE->EXITED, dwell), never a continuous location stream — mirrors
// device-playback-events' batch-with-per-item-result shape exactly. GEO
// campaign *playback* proof-of-play still goes through
// device-playback-events (record_device_playback_event now accepts both
// REGULAR and GEO campaigns); this endpoint is only the geofence
// enter/exit/dwell transition itself.

import {
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-geofence-events';
const MAX_EVENTS_PER_REQUEST = 50;

interface GeofenceEventBody {
  clientEventId?: string;
  geofenceId?: string;
  eventType?: 'enter' | 'exit' | 'dwell';
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  distanceMeters?: number;
  occurredAt?: string;
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

  let body: { events?: GeofenceEventBody[] };
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }

  const events = (body.events ?? []).slice(0, MAX_EVENTS_PER_REQUEST);
  const supabase = serviceClient();

  // MAX-013: same fix as device-playback-events — resolve device_id from
  // the single-use v2 bridge token exactly once, never re-present it per
  // event. See 20260820090000_fix_batch_endpoints_single_use_token.sql.
  const { data: deviceId, error: deviceIdError } = await supabase.rpc(
    'resolve_device_id_from_token',
    { p_token: token },
  );
  if (deviceIdError || !deviceId) {
    return jsonResponse(
      { error: 'unauthorized', message: deviceIdError?.message ?? 'Invalid device credential.' },
      401,
    );
  }

  const results = [];
  for (const event of events) {
    if (
      !event.clientEventId ||
      !event.geofenceId ||
      !event.eventType ||
      event.latitude === undefined ||
      event.longitude === undefined
    ) {
      results.push({
        clientEventId: event.clientEventId ?? null,
        ok: false,
        error: 'invalid_request',
      });
      continue;
    }

    const { data, error } = await supabase
      .rpc('record_device_geofence_event_for_device', {
        p_device_id: deviceId,
        p_campaign_geofence_id: event.geofenceId,
        p_event_type: event.eventType,
        p_latitude: event.latitude,
        p_longitude: event.longitude,
        p_accuracy_meters: event.accuracyMeters ?? null,
        p_distance_meters: event.distanceMeters ?? null,
        p_occurred_at: event.occurredAt ?? new Date().toISOString(),
        p_client_event_id: event.clientEventId,
      })
      .single();

    if (error) {
      console.error('device geofence event error', error.code);
      // MAX-013: same reasoning as device-playback-events — 22023 here
      // means geofenceId no longer exists, which no retry will fix.
      results.push({
        clientEventId: event.clientEventId,
        ok: false,
        permanent: error.code === '22023',
      });
      continue;
    }

    results.push({
      clientEventId: event.clientEventId,
      ok: true,
      recorded: data?.recorded ?? true,
    });
  }

  return jsonResponse({ results });
});
