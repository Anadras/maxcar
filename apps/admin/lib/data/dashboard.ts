import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function getDashboardCounts() {
  const supabase = await createClient();
  const [
    { count: advertisers, error: advertisersError },
    { count: establishments, error: establishmentsError },
    { count: activeCampaigns, error: activeError },
    { count: geoCampaigns, error: geoError },
  ] = await Promise.all([
    supabase.from('advertisers').select('*', { count: 'exact', head: true }),
    supabase.from('establishments').select('*', { count: 'exact', head: true }),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_type', 'geo'),
  ]);
  const error =
    advertisersError ?? establishmentsError ?? activeError ?? geoError;
  if (error) throw error;
  return {
    advertisers: advertisers ?? 0,
    establishments: establishments ?? 0,
    activeCampaigns: activeCampaigns ?? 0,
    geoCampaigns: geoCampaigns ?? 0,
  };
}
