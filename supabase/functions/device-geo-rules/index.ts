// GET /functions/v1/device-geo-rules
// Header: Authorization: Bearer <device token>
//
// Returns the GEO geofence rules a device should evaluate locally and
// offline, with a short-lived signed download URL per creative. Mirrors
// device-manifest exactly: get_device_geo_rules (SQL) does everything that
// can be expressed in SQL; signing URLs is the one extra per-item step this
// function does, so GEO creatives download through the exact same pipeline
// as REGULAR ones.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-geo-rules';
const DOWNLOAD_URL_TTL_SECONDS = 1800;

interface GeoRuleItem {
  geofenceId: string;
  campaignId: string;
  creativeId: string;
  establishmentId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority: number;
  cooldownSeconds: number;
  type: string;
  mimeType: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  sha256: string;
  storagePath: string;
  startsAt: string | null;
  endsAt: string | null;
}

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
  const { data, error } = await supabase.rpc('get_device_geo_rules', {
    p_token: token,
  });

  if (error) return errorResponse(error);

  const items: GeoRuleItem[] = data.rules ?? [];
  const rules = await Promise.all(
    items.map(async (item) => {
      const { data: signed } = await supabase.storage
        .from('campaign-media')
        .createSignedUrl(item.storagePath, DOWNLOAD_URL_TTL_SECONDS);
      return {
        geofenceId: item.geofenceId,
        campaignId: item.campaignId,
        creativeId: item.creativeId,
        establishmentId: item.establishmentId,
        latitude: item.latitude,
        longitude: item.longitude,
        radiusMeters: item.radiusMeters,
        priority: item.priority,
        cooldownSeconds: item.cooldownSeconds,
        type: item.type,
        mimeType: item.mimeType,
        durationSeconds: item.durationSeconds,
        fileSizeBytes: item.fileSizeBytes,
        sha256: item.sha256,
        downloadUrl: signed?.signedUrl ?? null,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      };
    }),
  );

  return jsonResponse({
    rulesVersion: data.rulesVersion,
    generatedAt: data.generatedAt,
    deviceId: data.deviceId,
    rules,
  });
});
