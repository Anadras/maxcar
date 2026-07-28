import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listCampaignCreatives(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_creatives')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return Promise.all(
    data.map(async (creative) => {
      const { data: signed } = await supabase.storage
        .from('campaign-media')
        .createSignedUrl(creative.storage_path, 600);
      return { ...creative, signedUrl: signed?.signedUrl ?? null };
    }),
  );
}
