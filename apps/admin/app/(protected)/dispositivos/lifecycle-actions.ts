'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { reauthenticateWithPassword } from '@/lib/auth/reauth';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

async function authorize(path: string) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(path, 'error', 'Ação não autorizada.'));
  }
  return auth;
}

export async function archiveDevice(id: string) {
  const detailPath = `/dispositivos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('archive_device', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/dispositivos');
  revalidatePath(detailPath);
  redirect(messageUrl(detailPath, 'success', 'Dispositivo arquivado.'));
}

export async function restoreDevice(id: string) {
  const detailPath = `/dispositivos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('restore_device', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/dispositivos');
  revalidatePath(detailPath);
  redirect(messageUrl(detailPath, 'success', 'Dispositivo restaurado.'));
}

export async function setDeviceActive(id: string, formData: FormData) {
  const detailPath = `/dispositivos/${id}`;
  await authorize(detailPath);
  const active = formData.get('active') === 'true';
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_device_active', {
    p_id: id,
    p_active: active,
  });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/dispositivos');
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      active ? 'Dispositivo reativado.' : 'Dispositivo desativado.',
    ),
  );
}

export async function unlinkDeviceVehicle(id: string) {
  const detailPath = `/dispositivos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('unlink_device_vehicle', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/dispositivos');
  revalidatePath('/veiculos');
  revalidatePath(detailPath);
  redirect(
    messageUrl(detailPath, 'success', 'Dispositivo desvinculado do veículo.'),
  );
}

export async function deleteDevicePermanently(id: string, formData: FormData) {
  const detailPath = `/dispositivos/${id}`;
  const auth = await authorize('/dispositivos');
  if (auth.profile.role !== 'super_admin') {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Apenas superadministradores podem excluir permanentemente.',
      ),
    );
  }

  const password = String(formData.get('password') ?? '');
  const confirmText = String(formData.get('confirmText') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (confirmText !== 'EXCLUIR') {
    redirect(messageUrl(detailPath, 'error', 'Digite EXCLUIR para confirmar.'));
  }
  if (!reason) {
    redirect(messageUrl(detailPath, 'error', 'Informe o motivo da exclusão.'));
  }
  const reauthOk = await reauthenticateWithPassword(auth.email, password);
  if (!reauthOk) {
    redirect(messageUrl(detailPath, 'error', 'Senha incorreta.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_device_permanently', {
    p_id: id,
    p_reason: reason,
  });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/dispositivos');
  redirect(
    messageUrl(
      '/dispositivos',
      'success',
      'Dispositivo excluído permanentemente.',
    ),
  );
}
