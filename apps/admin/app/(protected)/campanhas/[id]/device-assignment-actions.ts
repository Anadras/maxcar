'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

/**
 * Saves which tablets this campaign is restricted to (MAX-011 Bloco C) and
 * immediately asks every affected device to sync — both the newly
 * assigned ones (so they pick the campaign up) and the ones that lost
 * access (so they stop showing it). create_device_command is idempotent
 * per device+type, so this never piles up duplicate sync_now rows even if
 * the operator saves the same selection repeatedly.
 */
export async function setCampaignDevices(campaignId: string, formData: FormData) {
  const detailPath = `/campanhas/${campaignId}`;
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(detailPath, 'error', 'Ação não autorizada.'));
  }

  const supabase = await createClient();
  const scope = String(formData.get('scope') ?? 'all');
  const selectedDeviceIds = formData.getAll('deviceIds').map(String);
  const nextDeviceIds = scope === 'selected' ? selectedDeviceIds : [];

  const { data: previousAssignments } = await supabase
    .from('campaign_devices')
    .select('device_id')
    .eq('campaign_id', campaignId);
  const previousDeviceIds = (previousAssignments ?? []).map(
    (row) => row.device_id,
  );

  const { error } = await supabase.rpc('set_campaign_devices', {
    p_campaign_id: campaignId,
    p_device_ids: nextDeviceIds,
  });
  if (error) {
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  }

  const affectedDeviceIds = Array.from(
    new Set([...previousDeviceIds, ...nextDeviceIds]),
  );
  let syncRequests = 0;
  for (const deviceId of affectedDeviceIds) {
    const { error: commandError } = await supabase.rpc(
      'create_device_command',
      { p_device_id: deviceId, p_command_type: 'sync_now' },
    );
    if (!commandError) syncRequests++;
  }

  revalidatePath(detailPath);
  revalidatePath('/dispositivos');
  redirect(
    messageUrl(
      detailPath,
      'success',
      scope === 'all'
        ? 'Campanha liberada para todos os dispositivos ativos.'
        : `Campanha restrita a ${nextDeviceIds.length} dispositivo(s). ${syncRequests} tablet(s) foram avisados para sincronizar.`,
    ),
  );
}
