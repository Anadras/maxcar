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

// Same rationale as device-manifest's DOWNLOAD_URL_TTL_SECONDS: long
// enough to survive a slow download started right after this response,
// short enough to never be treated as a reusable credential.
const DOWNLOAD_URL_TTL_SECONDS = 1800;

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

  // MAX-014: a signed URL, same rule as device-manifest's creative
  // downloads — the storage path itself is never handed to the device,
  // only a short-lived signed URL that can't be re-shared as a standing
  // credential. Undefined for both fields when no release is currently
  // active for this device's channel (never sent as null vs. omitted
  // inconsistently — omission itself means "nothing to offer").
  let latestApkDownloadUrl: string | null = null;
  if (data.latest_apk_storage_path) {
    const { data: signed } = await supabase.storage
      .from('app-releases')
      .createSignedUrl(data.latest_apk_storage_path, DOWNLOAD_URL_TTL_SECONDS);
    latestApkDownloadUrl = signed?.signedUrl ?? null;
  }

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
    // MAX-014: present only when an active release exists for this
    // device's channel — the app compares latestApkVersionCode against
    // its own BuildConfig.VERSION_CODE and only acts when it's genuinely
    // newer, never on equal or older.
    latestApkVersionCode: data.latest_apk_version_code,
    latestApkVersionName: data.latest_apk_version_name,
    latestApkSha256: data.latest_apk_sha256,
    latestApkSizeBytes: data.latest_apk_size_bytes,
    latestApkDownloadUrl,
  });
});
