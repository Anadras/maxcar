// POST /functions/v1/device-enroll
// Body: { code, installationId, appVersion?, manufacturer?, model?, androidVersion? }
// Exchanges a short-lived, single-use, human-typed enrollment code for a
// long-lived opaque device credential. The device never sees a Supabase
// JWT or the service role key; only this function does.

import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

interface EnrollBody {
  code?: string;
  installationId?: string;
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

  let body: EnrollBody;
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
  if (!code || !installationId) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: 'code and installationId are required.',
      },
      400,
    );
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc('enroll_device', {
      p_code: code,
      p_installation_id: installationId,
      p_app_version: body.appVersion ?? null,
      p_manufacturer: body.manufacturer ?? null,
      p_model: body.model ?? null,
      p_android_version: body.androidVersion ?? null,
    })
    .single();

  // Attempt logging is a separate, independent call on purpose: see the
  // comment on record_device_enrollment_attempt for why it can't live
  // inside enroll_device itself.
  await supabase.rpc('record_device_enrollment_attempt', {
    p_installation_id: installationId,
    p_succeeded: !error,
  });

  if (error) return errorResponse(error);

  return jsonResponse({
    deviceToken: data.device_token,
    deviceId: data.device_id,
    deviceCode: data.device_code,
    vehicleId: data.vehicle_id,
    vehicleCode: data.vehicle_code,
  });
});
