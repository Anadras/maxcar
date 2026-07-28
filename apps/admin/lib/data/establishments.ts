import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listEstablishments(search = '') {
  const supabase = await createClient();
  let query = supabase
    .from('establishment_admin_view')
    .select('*')
    .order('name', { ascending: true });
  const term = search.trim().replaceAll(/[,%()]/g, ' ');
  if (term) {
    query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getEstablishment(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('establishment_admin_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
