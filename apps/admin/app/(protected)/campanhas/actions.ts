'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { authorizePilotDelete } from '@/lib/pilot-delete';
import { createClient } from '@/lib/supabase/server';
import {
  parseCampaignForm,
  parseOperationalDateTime,
} from '@/lib/validation/campaigns';

async function authorizeWrite() {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/campanhas', 'error', 'Ação não autorizada.'));
  }
}

function campaignError(error: { code?: string; message: string }) {
  console.error('Campaign persistence failed', {
    code: error.code,
    message: error.message,
  });
  if (error.code === '23514' && error.message.includes('structurally ready')) {
    return 'Para ativar, complete período, criativo e geofence quando for GEO.';
  }
  if (error.code === '42501') return 'Você não tem permissão para esta ação.';
  return 'Não foi possível salvar a campanha. Revise os dados e tente novamente.';
}

async function campaignPayload(formData: FormData, formPath: string) {
  const parsed = parseCampaignForm(formData);
  if (!parsed.success) {
    redirect(
      messageUrl(
        formPath,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const startsAt = parseOperationalDateTime(input.startsAt, input.utcOffset);
  const endsAt = parseOperationalDateTime(input.endsAt, input.utcOffset);
  if (!startsAt || !endsAt) {
    redirect(messageUrl(formPath, 'error', 'Período inválido.'));
  }

  const supabase = await createClient();
  const { data: advertiser, error: advertiserError } = await supabase
    .from('advertisers')
    .select('id')
    .eq('id', input.advertiserId)
    .eq('status', 'active')
    .maybeSingle();
  if (advertiserError || !advertiser) {
    redirect(
      messageUrl(
        formPath,
        'error',
        'O cliente selecionado não está disponível.',
      ),
    );
  }
  return {
    advertiser_id: advertiser.id,
    name: input.name,
    campaign_type: input.campaignType,
    status: input.status,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    daily_start_time: input.dailyStartTime || null,
    daily_end_time: input.dailyEndTime || null,
    priority: input.priority,
    cooldown_seconds: input.cooldownSeconds,
    playback_mode: input.playbackMode,
    max_wait_seconds: input.maxWaitSeconds,
    max_daily_impressions: input.maxDailyImpressions,
    active_days: [...new Set(input.activeDays)].sort(),
  };
}

export async function createCampaign(formData: FormData) {
  await authorizeWrite();
  const formPath = '/campanhas/nova';
  const payload = await campaignPayload(formData, formPath);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert(payload)
    .select('id')
    .single();
  if (error) redirect(messageUrl(formPath, 'error', campaignError(error)));
  revalidatePath('/campanhas');
  redirect(
    messageUrl(
      `/campanhas/${data.id}`,
      'success',
      'Campanha criada. Adicione os itens necessários antes de ativar.',
    ),
  );
}

export async function updateCampaign(id: string, formData: FormData) {
  await authorizeWrite();
  const formPath = `/campanhas/${id}/editar`;
  const payload = await campaignPayload(formData, formPath);
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update(payload)
    .eq('id', id)
    .select('id')
    .single();
  if (error) redirect(messageUrl(formPath, 'error', campaignError(error)));
  revalidatePath('/campanhas');
  revalidatePath(`/campanhas/${id}`);
  redirect(messageUrl(`/campanhas/${id}`, 'success', 'Campanha atualizada.'));
}

export async function deleteCampaignPermanently(
  id: string,
  formData: FormData,
) {
  const returnPath = `/campanhas/${id}`;
  const { reason } = await authorizePilotDelete(formData, returnPath);
  const supabase = await createClient();
  const { data: creatives, error: creativeError } = await supabase
    .from('campaign_creatives')
    .select('storage_path')
    .eq('campaign_id', id);
  if (creativeError) {
    redirect(
      messageUrl(returnPath, 'error', friendlyDatabaseError(creativeError)),
    );
  }
  const paths = creatives.map((item) => item.storage_path);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from('campaign-media')
      .remove(paths);
    if (storageError) {
      redirect(
        messageUrl(
          returnPath,
          'error',
          'Não foi possível remover os arquivos da campanha. Tente novamente.',
        ),
      );
    }
  }
  const { error } = await supabase.rpc('delete_campaign_permanently', {
    p_id: id,
    p_reason: reason,
  });
  if (error) {
    redirect(messageUrl(returnPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath('/campanhas');
  revalidatePath('/clientes');
  redirect(
    messageUrl('/clientes', 'success', 'Campanha e dados de teste excluídos.'),
  );
}
