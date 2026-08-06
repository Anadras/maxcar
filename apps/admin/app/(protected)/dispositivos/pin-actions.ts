'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

export async function setDeviceMaintenancePin(id: string, formData: FormData) {
  const detailPath = `/dispositivos/${id}`;
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Apenas superadministradores podem definir o PIN de manutenção.',
      ),
    );
  }

  const pin = String(formData.get('pin') ?? '').trim();
  const confirmPin = String(formData.get('confirmPin') ?? '').trim();
  if (pin !== confirmPin) {
    redirect(
      messageUrl(detailPath, 'error', 'Os PINs digitados não coincidem.'),
    );
  }
  if (!/^[0-9]{6}$/.test(pin)) {
    redirect(
      messageUrl(detailPath, 'error', 'O PIN deve ter exatamente 6 dígitos.'),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_device_maintenance_pin', {
    p_device_id: id,
    p_pin: pin,
  });
  if (error) {
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      'PIN de manutenção definido. Será entregue ao tablet no próximo ciclo de sincronização.',
    ),
  );
}

/**
 * Generates a single-use, 5-minute, online-only maintenance code (see
 * generate_device_maintenance_temp_code in
 * 20260821090000_pin_hardening_and_temp_codes.sql). Returned directly to
 * the caller — never via a redirect/query string, which would leave it
 * sitting in browser history and any request logging in front of this
 * app. This is the only place the plaintext code is ever visible; the DB
 * only ever stores a bcrypt hash of it.
 */
export async function generateDeviceMaintenanceTempCode(
  id: string,
  reason: string,
): Promise<
  { ok: true; code: string; expiresAt: string } | { ok: false; error: string }
> {
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') {
    return {
      ok: false,
      error: 'Apenas superadministradores podem gerar código temporário.',
    };
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { ok: false, error: 'Informe o motivo do código temporário.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'generate_device_maintenance_temp_code',
    { p_device_id: id, p_reason: trimmedReason },
  );
  if (error) {
    return { ok: false, error: friendlyDatabaseError(error) };
  }
  if (!data) {
    return { ok: false, error: 'Não foi possível concluir a operação.' };
  }
  revalidatePath(`/dispositivos/${id}`);
  return {
    ok: true,
    code: data,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

/** How long a temporary kiosk exit (physical PIN unlock or a
 * disable_kiosk_temporarily command) lasts before Lock Task automatically
 * re-engages on the tablet — see AppPreferences.kioskSuspendedUntilMillis
 * on the Android side. Empty clears the override and falls back to the
 * app's own 300s default. */
export async function setDeviceMaintenanceTimeout(
  id: string,
  formData: FormData,
) {
  const detailPath = `/dispositivos/${id}`;
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(detailPath, 'error', 'Ação não autorizada.'));
  }

  const raw = String(formData.get('maintenanceTimeoutSeconds') ?? '').trim();
  const seconds = raw === '' ? null : Number(raw);
  if (
    seconds !== null &&
    (!Number.isInteger(seconds) || seconds < 60 || seconds > 1800)
  ) {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'O tempo deve ser entre 60 e 1800 segundos.',
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_device_maintenance_timeout', {
    p_device_id: id,
    // The generated arg type doesn't reflect that this Postgres parameter
    // genuinely accepts NULL (no NOT NULL constraint, no default — the
    // generator only infers nullability from a default value) — NULL is
    // the deliberate "clear the override" case (see RPC body).
    p_seconds: seconds as number,
  });
  if (error) {
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      'Tempo de manutenção atualizado. Será entregue ao tablet no próximo ciclo de sincronização.',
    ),
  );
}
