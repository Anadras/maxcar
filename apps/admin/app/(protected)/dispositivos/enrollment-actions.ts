'use server';

import { revalidatePath } from 'next/cache';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';

export interface EnrollmentCodeState {
  error?: string;
  code?: string;
  expiresAt?: string;
}

async function authorize() {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    return null;
  }
  return auth;
}

export async function generateEnrollmentCode(
  deviceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (state, formData) signature
  _state: EnrollmentCodeState,
): Promise<EnrollmentCodeState> {
  if (!(await authorize())) {
    return { error: 'Ação não autorizada.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('generate_device_enrollment_code', { p_device_id: deviceId })
    .single();
  if (error || !data) {
    console.error('Enrollment code generation failed', {
      code: error?.code,
      message: error?.message,
    });
    return { error: 'Não foi possível gerar o código de ativação.' };
  }
  revalidatePath(`/dispositivos/${deviceId}`);
  return { code: data.code, expiresAt: data.expires_at };
}

export async function revokePendingEnrollmentCode(deviceId: string) {
  if (!(await authorize())) return;
  const supabase = await createClient();
  await supabase.rpc('revoke_device_enrollment_code', {
    p_device_id: deviceId,
  });
  revalidatePath(`/dispositivos/${deviceId}`);
}

export async function revokeDeviceCredential(deviceId: string) {
  if (!(await authorize())) return;
  const supabase = await createClient();
  await supabase.rpc('revoke_device_credential', { p_device_id: deviceId });
  revalidatePath(`/dispositivos/${deviceId}`);
}

/** MAX-010.6: revokes the tablet's active cryptographic key. Distinct from
 * [revokeDeviceCredential] (the older, static-token credential) — a
 * device can hold either or neither depending on which auth generation it
 * last enrolled under. The tablet regains identity the same way it always
 * has: a fresh activation code re-enrolls it (see generateEnrollmentCode),
 * or — if the on-device key itself is still intact — its own automatic
 * recovery flow, which this action deliberately can't distinguish from
 * here since it never sees the physical Keystore. */
export async function revokeDeviceKeyIdentity(deviceId: string) {
  if (!(await authorize())) return;
  const supabase = await createClient();
  await supabase.rpc('revoke_device_key', { p_device_id: deviceId });
  revalidatePath(`/dispositivos/${deviceId}`);
}
