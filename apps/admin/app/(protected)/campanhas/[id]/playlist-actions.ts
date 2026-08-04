'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

async function writableRegularCampaign(campaignId: string) {
  const detailPath = `/campanhas/${campaignId}`;
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(detailPath, 'error', 'Ação não autorizada.'));
  }
  const supabase = await createClient();
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('id, campaign_type')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !campaign) {
    redirect(messageUrl('/campanhas', 'error', 'Campanha não encontrada.'));
  }
  if (campaign.campaign_type !== 'regular') {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Apenas campanhas REGULAR entram na grade do piloto.',
      ),
    );
  }
  return { supabase, detailPath };
}

async function defaultPlaylistId(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data: existing, error: selectError } = await supabase
    .from('playlists')
    .select('id')
    .is('device_id', null)
    .eq('active', true)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from('playlists')
    .insert({ name: 'Grade padrão do piloto', device_id: null })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return created.id;
}

export async function addCampaignToDefaultPlaylist(campaignId: string) {
  const { supabase, detailPath } = await writableRegularCampaign(campaignId);
  try {
    const playlistId = await defaultPlaylistId(supabase);
    const { data: last } = await supabase
      .from('playlist_items')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from('playlist_items').insert({
      playlist_id: playlistId,
      campaign_id: campaignId,
      position: (last?.position ?? 0) + 1,
    });
    if (error) throw error;
  } catch (error) {
    console.error('Failed to add campaign to the default playlist', {
      code: (error as { code?: string }).code,
    });
    redirect(
      messageUrl(detailPath, 'error', 'Não foi possível incluir na grade.'),
    );
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(detailPath, 'success', 'Campanha incluída na grade do piloto.'),
  );
}

export async function removeCampaignFromDefaultPlaylist(campaignId: string) {
  const { supabase, detailPath } = await writableRegularCampaign(campaignId);
  const { data: playlist } = await supabase
    .from('playlists')
    .select('id')
    .is('device_id', null)
    .eq('active', true)
    .maybeSingle();
  if (playlist) {
    const { error } = await supabase
      .from('playlist_items')
      .delete()
      .eq('playlist_id', playlist.id)
      .eq('campaign_id', campaignId);
    if (error) {
      console.error('Failed to remove campaign from the default playlist', {
        code: error.code,
      });
      redirect(
        messageUrl(detailPath, 'error', 'Não foi possível remover da grade.'),
      );
    }
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(detailPath, 'success', 'Campanha removida da grade do piloto.'),
  );
}
