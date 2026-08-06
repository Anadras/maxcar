// GET /functions/v1/device-config
// Header: Authorization: Bearer <device token>
//
// Returns the device's identity summary plus the current server-controlled
// remote config (heartbeat/sync intervals, kiosk flag, logging level).
// Called once after enrollment and again whenever the app wants to check
// for a config change (config_version).

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-config';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(
      { error: 'invalid_request', message: 'GET required.' },
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
    // MAX-010: lets the tablet validate its admin PIN fully offline —
    // the plaintext PIN itself is never sent anywhere past
    // set_device_maintenance_pin.
    maintenancePinHash: data.maintenance_pin_hash,
    maintenancePinSalt: data.maintenance_pin_salt,
    // MAX-013: 1 = legacy sha256(pin||salt), 2 = bcrypt (self-contained,
    // maintenancePinSalt unused) — see kiosk/PinValidator.kt.
    maintenancePinHashVersion: data.maintenance_pin_hash_version,
    // MAX-011: null lets the tablet fall back to its own built-in default
    // (RemoteConfigEntity.DEFAULT_MAINTENANCE_TIMEOUT_SECONDS) rather than
    // the server needing to bake one in for every device row.
    maintenanceTimeoutSeconds: data.maintenance_timeout_seconds,
  });
});
