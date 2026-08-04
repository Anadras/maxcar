// POST /functions/v1/device-recover-key-complete
// Body: { recoveryAttemptId, signature }
//
// Second half of the recovery flow (see device-recover-key-start):
// proves possession of the private key matching the fingerprint that
// started this attempt, exactly like enrollment's proof of possession,
// then hands back the same non-secret deviceId/keyId/deviceCode the
// original enrollment returned — never creates or changes any
// credential, purely confirms an identity that was already active.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { base64ToBytes, verifyEcdsaP256Signature } from '../_shared/device-signature.ts';

interface CompleteBody {
  recoveryAttemptId?: string;
  signature?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'invalid_request', message: 'POST required.' },
      405,
    );
  }

  let body: CompleteBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: 'invalid_request', message: 'Body must be JSON.' },
      400,
    );
  }

  const recoveryAttemptId =
    typeof body.recoveryAttemptId === 'string' ? body.recoveryAttemptId : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!recoveryAttemptId || !signature) {
    return jsonResponse(
      { error: 'invalid_request', message: 'recoveryAttemptId and signature are required.' },
      400,
    );
  }

  const supabase = serviceClient();
  const { data: challengeRows, error: challengeError } = await supabase.rpc(
    'get_device_key_recovery_challenge',
    { p_recovery_attempt_id: recoveryAttemptId },
  );
  if (challengeError || !challengeRows || challengeRows.length === 0) {
    return jsonResponse(
      { error: 'invalid_request', message: 'Recovery attempt not found or expired.' },
      404,
    );
  }
  const challenge = challengeRows[0] as {
    public_key_der: string;
    challenge: string;
    expires_at: string;
  };
  if (Date.parse(challenge.expires_at) < Date.now()) {
    return jsonResponse(
      { error: 'invalid_request', message: 'Recovery attempt not found or expired.' },
      404,
    );
  }

  const signatureValid = await verifyEcdsaP256Signature(
    challenge.public_key_der,
    signature,
    base64ToBytes(challenge.challenge),
  );
  if (!signatureValid) {
    return jsonResponse(
      { error: 'unauthorized', message: 'Invalid proof of possession.' },
      401,
    );
  }

  const { data, error } = await supabase
    .rpc('complete_device_key_recovery', { p_recovery_attempt_id: recoveryAttemptId })
    .single();
  if (error) return errorResponse(error);

  return jsonResponse({
    deviceId: data.device_id,
    deviceCode: data.device_code,
    keyId: data.key_id,
    vehicleId: data.vehicle_id,
    vehicleCode: data.vehicle_code,
  });
});
