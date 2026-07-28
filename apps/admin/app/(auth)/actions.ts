'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
}

export async function login(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Informe e-mail e senha.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: 'E-mail ou senha inválidos.' };
  redirect('/');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
