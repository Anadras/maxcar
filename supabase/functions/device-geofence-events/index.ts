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
  bearerToken,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

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

  const token = bearerToken(req);
  if (!token) {
    return jsonResponse(
      { error: 'unauthorized', message: 'Missing device credential.' },
      401,
    );
  }

  let body: { events?: GeofenceEventBody[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }

  const events = (body.events ?? []).slice(0, MAX_EVENTS_PER_REQUEST);
  const supabase = serviceClient();

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
      .rpc('record_device_geofence_event', {
        p_token: token,
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
      // A 401 (revoked/invalid credential) applies to the whole batch, not
      // just this event: stop immediately so the caller can react once.
      if (error.code === '42501') {
        return jsonResponse(
          { error: 'unauthorized', message: error.message },
          401,
        );
      }
      console.error('device geofence event error', error.code);
      results.push({ clientEventId: event.clientEventId, ok: false });
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
