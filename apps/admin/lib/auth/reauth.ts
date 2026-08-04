import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Confirms the current super_admin's password before an irreversible
 * action. Calls Supabase Auth's own sign-in, server-side, on the same
 * session's client — never a hand-rolled comparison, never a stored or
 * logged copy of the password. The password value itself is discarded
 * the moment this function returns.
 */
export async function reauthenticateWithPassword(
  email: string,
  password: string,
): Promise<boolean> {
  if (!email || !password) return false;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return !error;
}
