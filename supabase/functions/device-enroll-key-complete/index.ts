// POST /functions/v1/device-enroll-key-complete
// Body: { enrollmentAttemptId, signature }
//
// Second half of MAX-010.6's challenge-response enrollment: the caller
// must prove it holds the private key matching the public key it
// submitted to device-enroll-key-start, by signing that exact challenge
// (ECDSA P-256/SHA-256, IEEE P1363 raw r||s format, base64). Only once
// that's verified does complete_device_key_enrollment ever consume the
// enrollment code or create a credential — see that function's own
// comment for why it trusts this Edge Function's verification instead of
// repeating it in PL/pgSQL.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';
import { base64ToBytes, verifyEcdsaP256Signature } from '../_shared/device-signature.ts';

interface CompleteBody {
  enrollmentAttemptId?: string;
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

  const enrollmentAttemptId =
    typeof body.enrollmentAttemptId === 'string' ? body.enrollmentAttemptId : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!enrollmentAttemptId || !signature) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: 'enrollmentAttemptId and signature are required.',
      },
      400,
    );
  }

  const supabase = serviceClient();
  const { data: challengeRows, error: challengeError } = await supabase.rpc(
    'get_device_key_enrollment_challenge',
    { p_enrollment_attempt_id: enrollmentAttemptId },
  );
  if (challengeError || !challengeRows || challengeRows.length === 0) {
    return jsonResponse(
      { error: 'attempt_not_found', message: 'Enrollment attempt not found.' },
      404,
    );
  }
  const challenge = challengeRows[0] as {
    public_key_der: string;
    challenge: string;
    expires_at: string;
    completed_at: string | null;
  };
  // Deliberately no expiry check here: complete_device_key_enrollment is
  // the single source of truth for that, and — unlike a plain expires_at
  // comparison — it also handles the idempotent-replay case correctly
  // (an attempt that already completed successfully must still succeed on
  // retry even if its challenge window has since passed).

  const signatureValid = await verifyEcdsaP256Signature(
    challenge.public_key_der,
    signature,
    base64ToBytes(challenge.challenge),
  );
  if (!signatureValid) {
    return jsonResponse(
      { error: 'invalid_signature', message: 'Invalid proof of possession.' },
      401,
    );
  }

  const { data, error } = await supabase
    .rpc('complete_device_key_enrollment', {
      p_enrollment_attempt_id: enrollmentAttemptId,
    })
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
