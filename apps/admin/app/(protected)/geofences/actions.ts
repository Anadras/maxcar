'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  parseGeofenceForm,
  simulationSchema,
} from '@/lib/validation/geofences';

async function authorizeWrite() {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/geofences', 'error', 'Ação não autorizada.'));
  }
}

function geofenceError(error: { code?: string; message: string }) {
  console.error('Geofence link persistence failed', {
    code: error.code,
    message: error.message,
  });
  if (error.code === '23505')
    return 'Esta campanha já está vinculada a esta geofence.';
  if (error.code === '23514')
    return 'Use uma campanha GEO e uma geofence de um estabelecimento do mesmo cliente.';
  if (error.code === '42501') return 'Você não tem permissão para esta ação.';
  return 'Não foi possível salvar. Revise os dados.';
}

async function geofencePayload(formData: FormData, path: string) {
  const parsed = parseGeofenceForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        path,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const [{ data: campaign }, { data: geofence }] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, advertiser_id, campaign_type')
      .eq('id', input.campaignId)
      .maybeSingle(),
    supabase
      .from('geofence_admin_view')
      .select('id, advertiser_id')
      .eq('id', input.geofenceId)
      .maybeSingle(),
  ]);
  if (
    !campaign ||
    campaign.campaign_type !== 'geo' ||
    !geofence?.id ||
    campaign.advertiser_id !== geofence.advertiser_id
  ) {
    redirect(
      messageUrl(
        path,
        'error',
        'Campanha e geofence devem ser GEO e do mesmo cliente.',
      ),
    );
  }
  return {
    campaign_id: campaign.id,
    geofence_id: geofence.id,
    priority_override: input.priorityOverride,
    cooldown_override_seconds: input.cooldownOverrideSeconds,
    playback_mode_override: input.playbackModeOverride,
    max_wait_seconds_override: input.maxWaitSecondsOverride,
    active: input.active,
  };
}

export async function createGeofence(formData: FormData) {
  await authorizeWrite();
  const path = '/geofences/nova';
  const payload = await geofencePayload(formData, path);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofences')
    .insert(payload)
    .select('id, campaign_id')
    .single();
  if (error) redirect(messageUrl(path, 'error', geofenceError(error)));
  revalidatePath('/geofences');
  revalidatePath(`/campanhas/${data.campaign_id}`);
  redirect(
    messageUrl(`/geofences/${data.id}`, 'success', 'Geofence vinculada.'),
  );
}

export async function updateGeofence(id: string, formData: FormData) {
  await authorizeWrite();
  const path = `/geofences/${id}/editar`;
  const payload = await geofencePayload(formData, path);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofences')
    .update({
      geofence_id: payload.geofence_id,
      priority_override: payload.priority_override,
      cooldown_override_seconds: payload.cooldown_override_seconds,
      playback_mode_override: payload.playback_mode_override,
      max_wait_seconds_override: payload.max_wait_seconds_override,
      active: payload.active,
    })
    .eq('id', id)
    .select('id, campaign_id')
    .single();
  if (error) redirect(messageUrl(path, 'error', geofenceError(error)));
  revalidatePath('/geofences');
  revalidatePath(`/campanhas/${data.campaign_id}`);
  redirect(
    messageUrl(`/geofences/${data.id}`, 'success', 'Geofence atualizada.'),
  );
}

export interface SimulationState {
  error?: string;
  result?: {
    distanceMeters: number;
    radiusMeters: number;
    withinRadius: boolean;
    eligible: boolean;
  };
}

export async function simulateGeofence(
  geofenceId: string,
  _state: SimulationState,
  formData: FormData,
): Promise<SimulationState> {
  const parsed = simulationSchema.safeParse({
    geofenceId,
    latitude: formData.get('latitude'),
    longitude: formData.get('longitude'),
  });
  if (!parsed.success) {
    return { error: 'Informe latitude e longitude válidas.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('simulate_geofence_eligibility', {
    p_geofence_id: geofenceId,
    p_latitude: parsed.data.latitude,
    p_longitude: parsed.data.longitude,
    p_operational_timezone: 'America/Campo_Grande',
  });
  if (error || !data[0]) {
    console.error('Geofence simulation failed', {
      code: error?.code,
      message: error?.message,
    });
    return { error: 'Não foi possível simular esta posição.' };
  }
  return {
    result: {
      distanceMeters: data[0].distance_meters,
      radiusMeters: data[0].radius_meters,
      withinRadius: data[0].within_radius,
      eligible: data[0].eligible,
    },
  };
}
