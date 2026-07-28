'use server';

import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  creativeMetadataSchema,
  inspectCreativeFile,
} from '@/lib/validation/creatives';

async function writableCampaign(campaignId: string) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/campanhas', 'error', 'Ação não autorizada.'));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, advertiser_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) {
    redirect(messageUrl('/campanhas', 'error', 'Campanha não encontrada.'));
  }
  return { supabase, campaign: data };
}

export async function uploadCreative(campaignId: string, formData: FormData) {
  const detailPath = `/campanhas/${campaignId}`;
  const { supabase, campaign } = await writableCampaign(campaignId);
  const metadata = creativeMetadataSchema.safeParse({
    name: formData.get('name'),
    durationSeconds: formData.get('durationSeconds'),
  });
  if (!metadata.success) {
    redirect(
      messageUrl(
        detailPath,
        'error',
        metadata.error.issues[0]?.message ?? 'Dados do criativo inválidos.',
      ),
    );
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    redirect(messageUrl(detailPath, 'error', 'Selecione um arquivo.'));
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = inspectCreativeFile(file, bytes);
  if (!inspection.success) {
    redirect(messageUrl(detailPath, 'error', inspection.error));
  }

  const creativeId = randomUUID();
  const storagePath = `advertisers/${campaign.advertiser_id}/campaigns/${campaign.id}/${creativeId}.${inspection.extension}`;
  const checksum = createHash('sha256').update(bytes).digest('hex');

  const { error: metadataError } = await supabase
    .from('campaign_creatives')
    .insert({
      id: creativeId,
      campaign_id: campaign.id,
      name: metadata.data.name,
      creative_type: inspection.creativeType,
      storage_path: storagePath,
      duration_seconds: metadata.data.durationSeconds,
      file_size_bytes: file.size,
      checksum,
    });
  if (metadataError) {
    console.error('Creative metadata insert failed', {
      code: metadataError.code,
      message: metadataError.message,
    });
    redirect(
      messageUrl(detailPath, 'error', 'Não foi possível registrar o criativo.'),
    );
  }

  const { error: uploadError } = await supabase.storage
    .from('campaign-media')
    .upload(storagePath, bytes, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    const { error: cleanupError } = await supabase
      .from('campaign_creatives')
      .delete()
      .eq('id', creativeId);
    console.error('Creative upload failed', {
      message: uploadError.message,
      metadataCleanupFailed: Boolean(cleanupError),
    });
    redirect(
      messageUrl(
        detailPath,
        'error',
        'O upload não foi concluído. Nenhum criativo foi ativado.',
      ),
    );
  }

  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      'Criativo enviado, validado e processado com SHA-256.',
    ),
  );
}

export async function setCreativeActive(
  campaignId: string,
  creativeId: string,
  active: boolean,
) {
  const detailPath = `/campanhas/${campaignId}`;
  const { supabase } = await writableCampaign(campaignId);
  const { error } = await supabase
    .from('campaign_creatives')
    .update({ active })
    .eq('id', creativeId)
    .eq('campaign_id', campaignId)
    .select('id')
    .single();
  if (error) {
    console.error('Creative status update failed', {
      code: error.code,
      message: error.message,
    });
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Não é possível desativar um criativo obrigatório de campanha ativa.',
      ),
    );
  }
  revalidatePath(detailPath);
  redirect(messageUrl(detailPath, 'success', 'Status do criativo atualizado.'));
}
