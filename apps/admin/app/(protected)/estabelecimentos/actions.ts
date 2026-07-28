'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { parseEstablishmentForm } from '@/lib/validation/establishments';

async function save(id: string | null, formData: FormData) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/estabelecimentos', 'error', 'Ação não autorizada.'));
  }
  const parsed = parseEstablishmentForm(formData);
  const formPath = id
    ? `/estabelecimentos/${id}/editar`
    : '/estabelecimentos/novo';
  if (!parsed.success) {
    redirect(
      messageUrl(
        formPath,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_establishment', {
    // Postgres accepts NULL here for create; generated RPC args omit nullability.
    p_id: id as string,
    p_advertiser_id: input.advertiserId,
    p_name: input.name,
    p_address_line: input.addressLine,
    p_number: input.number ?? '',
    p_complement: input.complement ?? '',
    p_neighborhood: input.neighborhood ?? '',
    p_city: input.city,
    p_state: input.state,
    p_postal_code: input.postalCode ?? '',
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_active: input.active,
  });
  if (error) {
    redirect(messageUrl(formPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath('/estabelecimentos');
  redirect(
    messageUrl(
      `/estabelecimentos/${data.id}`,
      'success',
      id ? 'Estabelecimento atualizado.' : 'Estabelecimento criado.',
    ),
  );
}

export async function createEstablishment(formData: FormData) {
  return save(null, formData);
}

export async function updateEstablishment(id: string, formData: FormData) {
  return save(id, formData);
}
