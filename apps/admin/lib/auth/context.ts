import type { AppRole } from '@maxcar/shared';
import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface AuthContext {
  userId: string;
  email: string;
  profile: {
    fullName: string;
    role: AppRole;
    active: boolean;
  };
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== 'string') return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, role, active')
    .eq('id', userId)
    .single();
  if (error || !profile) return null;

  const claimEmail = claimsData?.claims.email;
  return {
    userId,
    email: typeof claimEmail === 'string' ? claimEmail : '',
    profile: {
      fullName: profile.full_name?.trim() || 'Usuário MAXCAR',
      role: profile.role,
      active: profile.active,
    },
  };
}
