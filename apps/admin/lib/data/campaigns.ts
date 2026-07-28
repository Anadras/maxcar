import type {
  CampaignStatus,
  DatabaseCampaignType,
} from '@maxcar/shared/database-types';
import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface CampaignFilters {
  query?: string;
  advertiserId?: string;
  campaignType?: DatabaseCampaignType;
  status?: CampaignStatus;
}

export async function listCampaigns(filters: CampaignFilters = {}) {
  const supabase = await createClient();
  let query = supabase
    .from('campaign_admin_view')
    .select('*')
    .order('created_at', { ascending: false });
  const term = filters.query?.trim().replaceAll(/[,%()]/g, ' ');
  if (term) query = query.ilike('name', `%${term}%`);
  if (filters.advertiserId)
    query = query.eq('advertiser_id', filters.advertiserId);
  if (filters.campaignType)
    query = query.eq('campaign_type', filters.campaignType);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCampaign(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_admin_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listGeoCampaignOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_admin_view')
    .select('id, name, advertiser_id, advertiser_name, status')
    .eq('campaign_type', 'geo')
    .order('name');
  if (error) throw error;
  return data;
}

export async function getCampaignMetrics() {
  const supabase = await createClient();
  const [
    { count: active, error: activeError },
    { count: geo, error: geoError },
    { count: scheduled, error: scheduledError },
  ] = await Promise.all([
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_type', 'geo'),
    supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scheduled'),
  ]);
  if (activeError || geoError || scheduledError)
    throw activeError ?? geoError ?? scheduledError;
  return { active: active ?? 0, geo: geo ?? 0, scheduled: scheduled ?? 0 };
}
