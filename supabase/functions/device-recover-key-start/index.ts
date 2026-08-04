// POST /functions/v1/device-recover-key-start
// Body: { publicKeyFingerprint }
//
// MAX-010.6 recovery path: if a device's local, non-secret metadata
// (deviceId/keyId) is ever lost while its Android-Keystore-resident key
// pair is still intact, the app re-derives its own public key and
// fingerprint from the Keystore (no stored state required for that) and
// starts this challenge-response flow to recover its identifiers —
// never a new human-typed activation code, since the cryptographic
// identity itself was never actually lost.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

interface StartBody {
  publicKeyFingerprint?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'invalid_request', message: 'POST required.' },
      405,
    );
  }

  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }

  const publicKeyFingerprint =
    typeof body.publicKeyFingerprint === 'string' ? body.publicKeyFingerprint : '';
  if (!publicKeyFingerprint) {
    return jsonResponse(
      { error: 'invalid_request', message: 'publicKeyFingerprint is required.' },
      400,
    );
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc('start_device_key_recovery', { p_public_key_fingerprint: publicKeyFingerprint })
    .single();
  if (error) return errorResponse(error);

  return jsonResponse({
    recoveryAttemptId: data.recovery_attempt_id,
    challenge: data.challenge,
    expiresAt: data.expires_at,
  });
});
