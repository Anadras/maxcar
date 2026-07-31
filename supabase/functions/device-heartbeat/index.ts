// POST /functions/v1/device-heartbeat
// Header: Authorization: Bearer <device token>
// Body: { batteryLevel?, networkType?, storageFreeBytes?, appVersion?, deviceTime?, clientEventId? }
//
// The server never trusts a device-supplied device_id: the token itself is
// hashed and looked up server-side (private.device_id_for_token) to derive
// which device is reporting. deviceTime is accepted as metadata only —
// recorded_at always comes from the server clock.

import {
  bearerToken,
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

interface HeartbeatBody {
  batteryLevel?: number;
  networkType?: 'wifi' | 'cellular' | 'offline';
  storageFreeBytes?: number;
  appVersion?: string;
  deviceTime?: string;
  clientEventId?: string;
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

  let body: HeartbeatBody;
  try {
    body = await req.json();
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
    })
    .single();

  if (error) return errorResponse(error);

  return jsonResponse({
    deviceId: data.out_device_id,
    deviceCode: data.device_code,
    recordedAt: data.recorded_at,
  });
});
