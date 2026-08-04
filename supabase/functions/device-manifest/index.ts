// GET /functions/v1/device-manifest
// Header: Authorization: Bearer <device token>
//
// Returns the REGULAR-campaign playlist a device should sync, with a
// short-lived signed download URL per item. get_device_manifest (SQL) does
// everything that can be expressed in SQL — eligibility, ordering, the
// content hash used as manifestVersion; signing URLs can't be done in SQL,
// so this function does exactly that one extra step per item.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-manifest';

// Long enough to survive a slow 4G download started right after fetching
// the manifest; short enough that it's never treated as a stored,
// reusable credential. A new sync issues a fresh one.
const DOWNLOAD_URL_TTL_SECONDS = 1800;

interface ManifestItem {
  campaignId: string;
  creativeId: string;
  type: string;
  mimeType: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  sha256: string;
  storagePath: string;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
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
  const { data, error } = await supabase.rpc('get_device_manifest', {
    p_token: token,
  });

  if (error) return errorResponse(error);

  const items: ManifestItem[] = data.playlist ?? [];
  const playlist = await Promise.all(
    items.map(async (item) => {
      const { data: signed } = await supabase.storage
        .from('campaign-media')
        .createSignedUrl(item.storagePath, DOWNLOAD_URL_TTL_SECONDS);
      return {
        campaignId: item.campaignId,
        creativeId: item.creativeId,
        type: item.type,
        mimeType: item.mimeType,
        durationSeconds: item.durationSeconds,
        fileSizeBytes: item.fileSizeBytes,
        sha256: item.sha256,
        downloadUrl: signed?.signedUrl ?? null,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        position: item.position,
      };
    }),
  );

  return jsonResponse({
    manifestVersion: data.manifestVersion,
    generatedAt: data.generatedAt,
    deviceId: data.deviceId,
    playlist,
  });
});
