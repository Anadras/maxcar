// POST /functions/v1/device-playback-events
// Header: Authorization: Bearer <device token>
// Body: { events: [{ clientEventId, campaignId, creativeId, status,
//                     startedAt, completedAt?, durationMs?,
//                     completionPercentage?, failureReason?, offline? }] }
//
// Android only ever uploads a FINALIZED playback record (completed, failed
// or interrupted) — never a live "still playing" event — so each event
// maps to exactly one idempotent insert, the same shape as
// record_device_heartbeat. Processes the batch sequentially and reports
// per-event success so the caller knows precisely which local rows are
// safe to delete; one bad event in a batch must not fail the rest.

import {
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-playback-events';

// Keeps a single request bounded regardless of what a client sends;
// anything beyond this is picked up on the next sync cycle.
const MAX_EVENTS_PER_REQUEST = 50;

interface PlaybackEventBody {
  clientEventId?: string;
  campaignId?: string;
  creativeId?: string;
  status?: 'started' | 'completed' | 'interrupted' | 'failed';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  completionPercentage?: number;
  failureReason?: string;
  offline?: boolean;
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

  let body: { events?: PlaybackEventBody[] };
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

  // MAX-013: the v2 bridge token minted above is single-use by design
  // (private.device_id_for_token marks it used on first lookup) — a
  // batch endpoint must resolve device_id exactly once and reuse *that*,
  // never re-present the same token per event, or every event after the
  // first in a batch fails with what looks like (but isn't) a revoked
  // credential. See 20260820090000_fix_batch_endpoints_single_use_token.sql.
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
    if (!event.clientEventId || !event.campaignId || !event.status) {
      results.push({
        clientEventId: event.clientEventId ?? null,
        ok: false,
        error: 'invalid_request',
      });
      continue;
    }

    const { data, error } = await supabase
      .rpc('record_device_playback_event_for_device', {
        p_device_id: deviceId,
        p_campaign_id: event.campaignId,
        p_creative_id: event.creativeId ?? null,
        p_status: event.status,
        p_started_at: event.startedAt ?? new Date().toISOString(),
        p_completed_at: event.completedAt ?? null,
        p_duration_ms: event.durationMs ?? null,
        p_completion_percentage: event.completionPercentage ?? null,
        p_failure_reason: event.failureReason ?? null,
        p_offline: event.offline ?? false,
        p_client_event_id: event.clientEventId,
      })
      .single();

    if (error) {
      console.error('device playback event error', error.code);
      // MAX-013: 22023 here is exclusively record_device_playback_event_for_device's
      // own "campaignId does not reference a known campaign" check — the
      // campaign was deleted after this event was already queued locally
      // (sometimes hours earlier). No retry will ever fix that; tell the
      // client this row is safe to drop instead of holding the queue
      // hostage behind an event that can never succeed.
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
