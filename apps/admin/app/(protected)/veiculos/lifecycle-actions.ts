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

export async function archiveVehicle(id: string) {
  const detailPath = `/veiculos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('archive_vehicle', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/veiculos');
  revalidatePath(detailPath);
  redirect(messageUrl(detailPath, 'success', 'Veículo arquivado.'));
}

export async function restoreVehicle(id: string) {
  const detailPath = `/veiculos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('restore_vehicle', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/veiculos');
  revalidatePath(detailPath);
  redirect(messageUrl(detailPath, 'success', 'Veículo restaurado.'));
}

export async function setVehicleActive(id: string, formData: FormData) {
  const detailPath = `/veiculos/${id}`;
  await authorize(detailPath);
  const active = formData.get('active') === 'true';
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_vehicle_active', {
    p_id: id,
    p_active: active,
  });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/veiculos');
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      active ? 'Veículo reativado.' : 'Veículo desativado.',
    ),
  );
}

export async function unlinkVehicleDriver(id: string) {
  const detailPath = `/veiculos/${id}`;
  await authorize(detailPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('unlink_vehicle_driver', { p_id: id });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/veiculos');
  revalidatePath('/motoristas');
  revalidatePath(detailPath);
  redirect(
    messageUrl(detailPath, 'success', 'Motorista desvinculado do veículo.'),
  );
}

export async function deleteVehiclePermanently(id: string, formData: FormData) {
  const detailPath = `/veiculos/${id}`;
  const auth = await authorize('/veiculos');
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
  const { error } = await supabase.rpc('delete_vehicle_permanently', {
    p_id: id,
    p_reason: reason,
  });
  if (error)
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  revalidatePath('/veiculos');
  redirect(
    messageUrl('/veiculos', 'success', 'Veículo excluído permanentemente.'),
  );
}
