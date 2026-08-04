import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface AuditEventFilters {
  from?: string;
  to?: string;
  entityType?: string;
  action?: string;
  actorUserId?: string;
}

export async function listAuditEvents(filters: AuditEventFilters = {}) {
  const supabase = await createClient();
  let query = supabase
    .from('audit_events')
    .select(
      'id, action, entity_type, entity_label, reason, created_at, actor_role, actor_user_id',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);
  if (filters.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.actorUserId) query = query.eq('actor_user_id', filters.actorUserId);
  const { data, error } = await query;
  if (error) throw error;

  const actorIds = Array.from(
    new Set(data.map((event) => event.actor_user_id).filter((id): id is string => Boolean(id))),
  );
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds);
    for (const profile of profiles ?? []) {
      if (profile.full_name) actorNames.set(profile.id, profile.full_name);
    }
  }

  return data.map((event) => ({
    ...event,
    actor_name: event.actor_user_id
      ? (actorNames.get(event.actor_user_id) ?? 'Usuário removido')
      : 'Sistema',
  }));
}

/** Distinct users who ever appear as an audit actor — powers the
 * "Usuário" filter without listing every user in the system, only ones
 * relevant to this log. */
export async function listAuditActors() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('actor_user_id')
    .not('actor_user_id', 'is', null);
  if (error) throw error;
  const ids = Array.from(new Set(data.map((row) => row.actor_user_id as string)));
  if (ids.length === 0) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids)
    .order('full_name');
  if (profilesError) throw profilesError;
  return profiles;
}
