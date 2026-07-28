import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function listManagedUsers() {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const admin = createAdminClient();
  if (!admin) {
    return {
      configured: false as const,
      users: profiles.map((profile) => ({ ...profile, email: null })),
    };
  }
  const { data, error: authError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authError) throw authError;
  const emails = new Map(
    data.users.map((user) => [user.id, user.email ?? null]),
  );
  return {
    configured: true as const,
    users: profiles.map((profile) => ({
      ...profile,
      email: emails.get(profile.id) ?? null,
    })),
  };
}
