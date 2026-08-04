'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { creativeMetadataSchema } from '@/lib/validation/creatives';

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

const preparationSchema = creativeMetadataSchema.extend({
  creativeId: z.uuid(),
  creativeType: z.enum(['image', 'video']),
  extension: z.enum(['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm']),
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
  ]),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});

const acceptedFilePairs = new Set([
  'image:jpg:image/jpeg',
  'image:jpeg:image/jpeg',
  'image:png:image/png',
  'image:webp:image/webp',
  'video:mp4:video/mp4',
  'video:webm:video/webm',
]);

export async function prepareCreativeUpload(
  campaignId: string,
  input: z.input<typeof preparationSchema>,
) {
  const { supabase, campaign } = await writableCampaign(campaignId);
  const metadata = preparationSchema.safeParse(input);
  if (!metadata.success) {
    return {
      ok: false as const,
      error: metadata.error.issues[0]?.message ?? 'Dados do arquivo inválidos.',
    };
  }
  const pair = `${metadata.data.creativeType}:${metadata.data.extension}:${metadata.data.mimeType}`;
  if (!acceptedFilePairs.has(pair)) {
    return { ok: false as const, error: 'Formato de arquivo não aceito.' };
  }
  if (
    metadata.data.creativeType === 'image' &&
    metadata.data.fileSizeBytes > 10 * 1024 * 1024
  ) {
    return { ok: false as const, error: 'A imagem deve ter no máximo 10 MB.' };
  }
  const storagePath = `advertisers/${campaign.advertiser_id}/campaigns/${campaign.id}/${metadata.data.creativeId}.${metadata.data.extension}`;

  const { error: metadataError } = await supabase
    .from('campaign_creatives')
    .insert({
      id: metadata.data.creativeId,
      campaign_id: campaign.id,
      name: metadata.data.name,
      creative_type: metadata.data.creativeType,
      storage_path: storagePath,
      duration_seconds: metadata.data.durationSeconds,
      file_size_bytes: metadata.data.fileSizeBytes,
      checksum: metadata.data.checksum,
      active: false,
    });
  if (metadataError) {
    console.error('Creative metadata insert failed', {
      code: metadataError.code,
      message: metadataError.message,
    });
    return {
      ok: false as const,
      error: 'Não foi possível preparar o envio do arquivo.',
    };
  }
  return {
    ok: true as const,
    creativeId: metadata.data.creativeId,
    storagePath,
  };
}

export async function finalizeCreativeUpload(
  campaignId: string,
  creativeId: string,
) {
  const { supabase } = await writableCampaign(campaignId);
  const { data: creative, error: creativeError } = await supabase
    .from('campaign_creatives')
    .select('id, storage_path, active')
    .eq('id', creativeId)
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (creativeError || !creative) {
    return { ok: false as const, error: 'O envio não pôde ser finalizado.' };
  }
  const { error: signedUrlError } = await supabase.storage
    .from('campaign-media')
    .createSignedUrl(creative.storage_path, 60);
  if (signedUrlError) {
    return {
      ok: false as const,
      error: 'O arquivo não chegou ao armazenamento.',
    };
  }
  const { error: activationError } = await supabase
    .from('campaign_creatives')
    .update({ active: true })
    .eq('id', creativeId)
    .eq('campaign_id', campaignId);
  if (activationError) {
    return {
      ok: false as const,
      error: 'O arquivo chegou, mas não pôde ser ativado.',
    };
  }
  revalidatePath(`/campanhas/${campaignId}`);
  return { ok: true as const };
}

export async function cancelCreativeUpload(
  campaignId: string,
  creativeId: string,
) {
  const { supabase } = await writableCampaign(campaignId);
  await supabase
    .from('campaign_creatives')
    .delete()
    .eq('id', creativeId)
    .eq('campaign_id', campaignId)
    .eq('active', false);
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
