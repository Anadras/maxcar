'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl, optionalText } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { parseDriverForm } from '@/lib/validation/drivers';

async function authorize(path: string) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(path, 'error', 'Ação não autorizada.'));
  }
}

export async function createDriver(formData: FormData) {
  await authorize('/motoristas');
  const parsed = parseDriverForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        '/motoristas/novo',
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('drivers')
    .insert({
      full_name: input.fullName,
      document_number: optionalText(input.documentNumber ?? null),
      phone: optionalText(input.phone ?? null),
      email: optionalText(input.email ?? null),
      status: input.status,
    })
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl('/motoristas/novo', 'error', friendlyDatabaseError(error)),
    );
  revalidatePath('/motoristas');
  redirect(messageUrl(`/motoristas/${data.id}`, 'success', 'Piloto criado.'));
}

export async function updateDriver(id: string, formData: FormData) {
  await authorize(`/motoristas/${id}`);
  const parsed = parseDriverForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        `/motoristas/${id}/editar`,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('drivers')
    .update({
      full_name: input.fullName,
      document_number: optionalText(input.documentNumber ?? null),
      phone: optionalText(input.phone ?? null),
      email: optionalText(input.email ?? null),
      status: input.status,
    })
    .eq('id', id)
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl(
        `/motoristas/${id}/editar`,
        'error',
        friendlyDatabaseError(error),
      ),
    );
  revalidatePath('/motoristas');
  revalidatePath('/veiculos');
  redirect(messageUrl(`/motoristas/${id}`, 'success', 'Piloto atualizado.'));
}
