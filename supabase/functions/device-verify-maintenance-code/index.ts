// POST /functions/v1/device-verify-maintenance-code
// Body: { code: string }
//
// MAX-013's online fallback for the maintenance PIN: a technician who
// shouldn't learn the permanent PIN (or who's forgotten it) can be given
// a 6-digit, single-use, 5-minute code generated from the panel
// (generate_device_maintenance_temp_code). Requires the tablet to be
// online — unlike the PIN itself, this code is never cached locally and
// is verified against Cloud on every attempt, by design (a fully-offline
// temporary code would defeat its own "expires in 5 minutes, single use"
// guarantees).

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { resolveDeviceApiToken } from '../_shared/device-signature.ts';

const FUNCTION_PATH = '/device-verify-maintenance-code';

interface VerifyCodeBody {
  code?: string;
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

  let body: VerifyCodeBody;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }
  if (!body.code || !/^[0-9]{6}$/.test(body.code)) {
    return jsonResponse(
      { error: 'invalid_request', message: 'code must be exactly 6 digits.' },
      400,
    );
  }

  const supabase = serviceClient();
  const { data: verified, error } = await supabase.rpc(
    'verify_device_maintenance_temp_code',
    { p_token: token, p_code: body.code },
  );
  if (error) return errorResponse(error);

  return jsonResponse({ verified: verified === true });
});
