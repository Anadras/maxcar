import 'server-only';

import { createClient } from '@/lib/supabase/server';

export async function listAuditEvents() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select(
      'id, action, entity_type, entity_label, reason, created_at, actor_role',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}
