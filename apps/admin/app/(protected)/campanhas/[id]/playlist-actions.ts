'use server';

import { campaignReadinessIssues } from '@maxcar/business-rules';
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

/**
 * The operator-facing happy path: validates the campaign, puts REGULAR
 * content in the pilot grade, activates it and asks every operational
 * tablet to sync. The individual lower-level actions remain available for
 * recovery, but a non-technical user should not need to know that they
 * exist or in which order to run them.
 */
export async function publishCampaignAndSync(campaignId: string) {
  const detailPath = `/campanhas/${campaignId}`;
  const auth = await getAuthContext();
  if (
    !auth ||
    !canManageFleet(auth.profile.role) ||
    !['super_admin', 'admin'].includes(auth.profile.role)
  ) {
    redirect(messageUrl(detailPath, 'error', 'Ação não autorizada.'));
  }

  const supabase = await createClient();
  const [campaignResult, creativesResult, geofencesResult] = await Promise.all([
    supabase
      .from('campaigns')
      .select(
        'id, campaign_type, starts_at, ends_at, daily_start_time, daily_end_time, active_days, status',
      )
      .eq('id', campaignId)
      .maybeSingle(),
    supabase
      .from('campaign_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('active', true),
    supabase
      .from('campaign_geofences')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('active', true),
  ]);
  const campaign = campaignResult.data;
  if (
    campaignResult.error ||
    creativesResult.error ||
    geofencesResult.error ||
    !campaign
  ) {
    redirect(
      messageUrl(detailPath, 'error', 'Não foi possível revisar a campanha.'),
    );
  }

  const issues = campaignReadinessIssues({
    campaignType: campaign.campaign_type,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    dailyStartTime: campaign.daily_start_time,
    dailyEndTime: campaign.daily_end_time,
    activeDays: campaign.active_days ?? [],
    activeCreativeCount: creativesResult.count ?? 0,
    activeGeofenceCount: geofencesResult.count ?? 0,
  });
  if (issues.length > 0) {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Complete os passos indicados antes de colocar a campanha no ar.',
      ),
    );
  }

  let syncRequests = 0;
  try {
    if (campaign.campaign_type === 'regular') {
      const playlistId = await defaultPlaylistId(supabase);
      const { data: existing, error: existingError } = await supabase
        .from('playlist_items')
        .select('id')
        .eq('playlist_id', playlistId)
        .eq('campaign_id', campaignId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        const { error } = await supabase
          .from('playlist_items')
          .update({ active: true })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data: last, error: lastError } = await supabase
          .from('playlist_items')
          .select('position')
          .eq('playlist_id', playlistId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastError) throw lastError;
        const { error } = await supabase.from('playlist_items').insert({
          playlist_id: playlistId,
          campaign_id: campaignId,
          position: (last?.position ?? 0) + 1,
        });
        if (error) throw error;
      }
    }

    const { error: activationError } = await supabase
      .from('campaigns')
      .update({ status: 'active' })
      .eq('id', campaignId);
    if (activationError) throw activationError;

    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('id')
      .is('archived_at', null)
      .neq('status', 'retired');
    if (devicesError) throw devicesError;

    for (const device of devices ?? []) {
      const { error } = await supabase.rpc('create_device_command', {
        p_device_id: device.id,
        p_command_type: 'sync_now',
      });
      if (!error) syncRequests++;
    }
  } catch (error) {
    console.error('Failed to publish campaign and sync devices', {
      code: (error as { code?: string }).code,
    });
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Não foi possível colocar a campanha no ar. Revise os passos e tente novamente.',
      ),
    );
  }
  revalidatePath('/');
  revalidatePath('/campanhas');
  revalidatePath(detailPath);
  revalidatePath('/dispositivos');
  redirect(
    messageUrl(
      detailPath,
      'success',
      syncRequests > 0
        ? `Campanha no ar. ${syncRequests} tablet(s) receberam o pedido de sincronização.`
        : 'Campanha no ar. Ela será enviada quando um tablet operacional sincronizar.',
    ),
  );
}
