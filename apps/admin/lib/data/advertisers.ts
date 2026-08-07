import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listAdvertisers(search = '', status = '') {
  const supabase = await createClient();
  let query = supabase
    .from('advertisers')
    .select('*, establishments(id), campaigns(id, status)')
    .order('trade_name', { ascending: true });
  const term = search.trim().replaceAll(/[,%()]/g, ' ');
  if (term) {
    query = query.or(`trade_name.ilike.%${term}%,legal_name.ilike.%${term}%`);
  }
  if (status === 'active' || status === 'inactive' || status === 'suspended') {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data.map((item) => ({
    ...item,
    establishment_count: item.establishments.length,
    campaign_count: item.campaigns.length,
    active_campaign_count: item.campaigns.filter((c) => c.status === 'active').length,
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
