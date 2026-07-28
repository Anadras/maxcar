import type { Database } from '@maxcar/shared/database-types';
import { createClient } from '@supabase/supabase-js';
import 'server-only';
import { getPublicSupabaseConfig, getServiceRoleKey } from './env';

export function createAdminClient() {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) return null;

  return createClient<Database>(getPublicSupabaseConfig().url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
