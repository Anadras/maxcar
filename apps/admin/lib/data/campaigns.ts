import type { CampaignStatus, DatabaseCampaignType } from '@maxcar/shared';
import type { Database } from '@maxcar/shared/database-types';
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

  // How many devices each campaign is explicitly restricted to (MAX-011
  // Bloco C) — an empty count means "unrestricted, reaches every active
  // device", never "assigned to nobody", so the list must say so plainly
  // rather than showing a bare 0.
  const { data: assignments } = await supabase
    .from('campaign_devices')
    .select('campaign_id');
  const deviceCounts = new Map<string, number>();
  for (const row of assignments ?? []) {
    deviceCounts.set(row.campaign_id, (deviceCounts.get(row.campaign_id) ?? 0) + 1);
  }
  return data.map((campaign) => ({
    ...campaign,
    assigned_device_count: campaign.id ? (deviceCounts.get(campaign.id) ?? 0) : 0,
  }));
}

export async function getCampaign(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_admin_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!error) return data;

  // A campaign must remain editable even if the reporting view is briefly
  // unavailable after a deploy or schema refresh. The base table is the
  // authority for editing; the extra view counts are informational only.
  console.error('Campaign admin view unavailable; using base table', {
    campaignId: id,
    code: error.code,
  });
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) return null;

  let advertiserName: string | null = null;
  if (campaign.advertiser_id) {
    const { data: advertiser } = await supabase
      .from('advertisers')
      .select('trade_name')
      .eq('id', campaign.advertiser_id)
      .maybeSingle();
    advertiserName = advertiser?.trade_name ?? null;
  }
  return {
    ...campaign,
    advertiser_name: advertiserName,
    creative_count: null,
    geofence_count: null,
    impression_count: null,
  } satisfies Database['public']['Views']['campaign_admin_view']['Row'];
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
