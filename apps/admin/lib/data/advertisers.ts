import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listAdvertisers(search = '') {
  const supabase = await createClient();
  let query = supabase
    .from('advertisers')
    .select('*, establishments(id), campaigns(id)')
    .order('trade_name', { ascending: true });
  const term = search.trim().replaceAll(/[,%()]/g, ' ');
  if (term) {
    query = query.or(`trade_name.ilike.%${term}%,legal_name.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data.map((item) => ({
    ...item,
    establishment_count: item.establishments.length,
    campaign_count: item.campaigns.length,
  }));
}

export async function getAdvertiser(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('advertisers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
