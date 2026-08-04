// POST /functions/v1/device-enroll-key-start
// Body: { code, installationId, publicKey, publicKeyFingerprint, algorithm,
//         hardwareBacked?, appVersion?, manufacturer?, model?, androidVersion? }
//
// First half of MAX-010.6's challenge-response enrollment: validates the
// human-typed code and records the device's claimed public key alongside
// a random challenge, WITHOUT consuming the code or creating any
// credential yet — that only happens in device-enroll-key-complete, once
// this function's caller has proven it holds the matching private key by
// signing the challenge. publicKey is the device's Keystore-generated EC
// public key as base64 X.509 SubjectPublicKeyInfo DER (exactly
// KeyPair.public.encoded on Android, no conversion needed).

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

interface StartBody {
  code?: string;
  installationId?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  algorithm?: string;
  hardwareBacked?: boolean;
  appVersion?: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
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

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const installationId =
    typeof body.installationId === 'string' ? body.installationId : '';
  const publicKey = typeof body.publicKey === 'string' ? body.publicKey : '';
  const publicKeyFingerprint =
    typeof body.publicKeyFingerprint === 'string' ? body.publicKeyFingerprint : '';
  const algorithm = typeof body.algorithm === 'string' ? body.algorithm : '';
  if (!code || !installationId || !publicKey || !publicKeyFingerprint || !algorithm) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message:
          'code, installationId, publicKey, publicKeyFingerprint and algorithm are required.',
      },
      400,
    );
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc('start_device_key_enrollment', {
      p_code: code,
      p_installation_id: installationId,
      p_public_key_der: publicKey,
      p_public_key_fingerprint: publicKeyFingerprint,
      p_algorithm: algorithm,
      p_hardware_backed: body.hardwareBacked ?? null,
      p_app_version: body.appVersion ?? null,
      p_manufacturer: body.manufacturer ?? null,
      p_model: body.model ?? null,
      p_android_version: body.androidVersion ?? null,
    })
    .single();

  // Same independent-logging rationale as device-enroll's
  // record_device_enrollment_attempt call: this must survive even if the
  // RPC above rolled back.
  await supabase.rpc('record_device_enrollment_attempt', {
    p_installation_id: installationId,
    p_succeeded: !error,
  });

  if (error) return errorResponse(error);

  return jsonResponse({
    enrollmentAttemptId: data.enrollment_attempt_id,
    challenge: data.challenge,
    expiresAt: data.expires_at,
  });
});
