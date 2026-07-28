'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl, optionalText } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { parseAdvertiserForm } from '@/lib/validation/advertisers';

async function authorize() {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/clientes', 'error', 'Ação não autorizada.'));
  }
}

export async function createAdvertiser(formData: FormData) {
  await authorize();
  const parsed = parseAdvertiserForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        '/clientes/novo',
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('advertisers')
    .insert({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      document_number: optionalText(input.documentNumber ?? null),
      contact_name: optionalText(input.contactName ?? null),
      contact_email: optionalText(input.contactEmail ?? null),
      contact_phone: optionalText(input.contactPhone ?? null),
      status: input.status,
    })
    .select('id')
    .single();
  if (error) {
    redirect(
      messageUrl('/clientes/novo', 'error', friendlyDatabaseError(error)),
    );
  }
  revalidatePath('/clientes');
  redirect(messageUrl(`/clientes/${data.id}`, 'success', 'Cliente criado.'));
}

export async function updateAdvertiser(id: string, formData: FormData) {
  await authorize();
  const parsed = parseAdvertiserForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        `/clientes/${id}/editar`,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('advertisers')
    .update({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      document_number: optionalText(input.documentNumber ?? null),
      contact_name: optionalText(input.contactName ?? null),
      contact_email: optionalText(input.contactEmail ?? null),
      contact_phone: optionalText(input.contactPhone ?? null),
      status: input.status,
    })
    .eq('id', id)
    .select('id')
    .single();
  if (error) {
    redirect(
      messageUrl(
        `/clientes/${id}/editar`,
        'error',
        friendlyDatabaseError(error),
      ),
    );
  }
  revalidatePath('/clientes');
  redirect(messageUrl(`/clientes/${id}`, 'success', 'Cliente atualizado.'));
}
