import type { Database } from '@maxcar/shared/database-types';
import 'server-only';
import { createClient } from '@/lib/supabase/server';

type ProcessingJobRow = Pick<
  Database['public']['Tables']['media_processing_jobs']['Row'],
  | 'id'
  | 'creative_id'
  | 'media_version'
  | 'status'
  | 'attempts'
  | 'max_attempts'
  | 'last_error'
  | 'created_at'
  | 'completed_at'
>;

export type MediaStatusFilter = 'processing' | 'ready' | 'incompatible' | 'failed';

const PROCESSING_GROUP: Database['public']['Enums']['media_processing_status'][] =
  ['uploaded', 'queued', 'processing', 'probing', 'transcoding', 'validating_output'];

/** Cross-campaign view of every creative (MAX-017 item 6): lets an
 * operator find incompatible/failed media across the whole fleet without
 * hunting campaign by campaign. */
export async function listAllCreativesForMediaOverview(status?: MediaStatusFilter) {
  const supabase = await createClient();
  let query = supabase
    .from('campaign_creatives')
    .select('id, name, creative_type, processing_status, processing_error, processing_version, created_at, campaign_id, campaigns(name, advertiser_id, advertisers(trade_name))')
    .order('created_at', { ascending: false });
  if (status === 'ready') query = query.eq('processing_status', 'ready');
  else if (status === 'incompatible') query = query.eq('processing_status', 'incompatible');
  else if (status === 'failed') query = query.eq('processing_status', 'failed');
  else if (status === 'processing') query = query.in('processing_status', PROCESSING_GROUP);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function listCampaignCreatives(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_creatives')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const creativeIds = data.map((creative) => creative.id);
  let jobs: ProcessingJobRow[] = [];
  if (creativeIds.length) {
    const { data: jobRows } = await supabase
      .from('media_processing_jobs')
      .select('id, creative_id, media_version, status, attempts, max_attempts, last_error, created_at, completed_at')
      .in('creative_id', creativeIds)
      .order('created_at', { ascending: false });
    jobs = jobRows ?? [];
  }
  const jobsByCreative = new Map<string, ProcessingJobRow[]>();
  for (const job of jobs) {
    const list = jobsByCreative.get(job.creative_id) ?? [];
    list.push(job);
    jobsByCreative.set(job.creative_id, list);
  }

  return Promise.all(
    data.map(async (creative) => {
      const { data: signed } = await supabase.storage
        .from('campaign-media')
        .createSignedUrl(creative.storage_path, 600);
      return {
        ...creative,
        signedUrl: signed?.signedUrl ?? null,
        processingHistory: jobsByCreative.get(creative.id) ?? [],
      };
    }),
  );
}
