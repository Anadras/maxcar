'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

const nameSchema = z.string().trim().min(2).max(120);

export async function updateProfile(formData: FormData) {
  const parsed = nameSchema.safeParse(formData.get('fullName'));
  if (!parsed.success) {
    redirect(messageUrl('/perfil', 'error', 'Informe um nome válido.'));
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_own_profile_name', {
    p_full_name: parsed.data,
  });
  if (error) redirect(messageUrl('/perfil', 'error', error.message));
  revalidatePath('/perfil');
  redirect(messageUrl('/perfil', 'success', 'Perfil atualizado.'));
}
