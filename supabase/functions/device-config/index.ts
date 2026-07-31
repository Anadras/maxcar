// GET /functions/v1/device-config
// Header: Authorization: Bearer <device token>
//
// Returns the device's identity summary plus the current server-controlled
// remote config (heartbeat/sync intervals, kiosk flag, logging level).
// Called once after enrollment and again whenever the app wants to check
// for a config change (config_version).

import {
  bearerToken,
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(
      { error: 'invalid_request', message: 'GET required.' },
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

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc('get_device_config', { p_token: token })
    .single();

  if (error) return errorResponse(error);

  return jsonResponse({
    deviceId: data.device_id,
    deviceCode: data.device_code,
    vehicleId: data.vehicle_id,
    vehicleCode: data.vehicle_code,
    heartbeatIntervalSeconds: data.heartbeat_interval_seconds,
    syncIntervalSeconds: data.sync_interval_seconds,
    kioskEnabled: data.kiosk_enabled,
    loggingLevel: data.logging_level,
    configVersion: data.config_version,
  });
});
