import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** The pilot's single global default grade: the playlist row with no
 * device_id, used by any tablet without a dedicated playlist of its own.
 * See docs/architecture/ANDROID_MEDIA_SYNC.md. */
export async function getDefaultPilotPlaylist() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('playlists')
    .select('id, name, active')
    .is('device_id', null)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function isCampaignInDefaultPlaylist(campaignId: string) {
  const supabase = await createClient();
  const playlist = await getDefaultPilotPlaylist();
  if (!playlist) return false;
  const { data, error } = await supabase
    .from('playlist_items')
    .select('id')
    .eq('playlist_id', playlist.id)
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
