'use server';

import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';

export async function reorderCampaigns(campaignIds: string[]) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    return { ok: false as const, error: 'Ação não autorizada.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_default_playlist', {
    p_campaign_ids: campaignIds,
  });
  if (error) {
    return {
      ok: false as const,
      error:
        error.code === '22023'
          ? 'A ordem enviada não corresponde mais às campanhas REGULAR ativas. Recarregue a página e tente novamente.'
          : 'Não foi possível salvar a nova ordem.',
    };
  }
  return { ok: true as const };
}
