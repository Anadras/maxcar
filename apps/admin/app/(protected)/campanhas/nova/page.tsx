import { redirect } from 'next/navigation';
import { createCampaign } from '../actions';
import { CampaignForm } from '@/components/campaign-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listAdvertisers } from '@/lib/data/advertisers';

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{
    advertiser?: string;
    type?: 'regular' | 'geo';
    error?: string;
  }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/campanhas');
  const [params, advertisers] = await Promise.all([
    searchParams,
    listAdvertisers(),
  ]);
  return (
    <div className="page campaign-editor">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="NOVA CAMPANHA"
        title="Criar campanha"
        description="Preencha o essencial agora. Na próxima etapa você envia a arte e coloca a campanha no ar."
      />
      <CampaignForm
        advertisers={advertisers.filter((item) => item.status === 'active')}
        action={createCampaign}
        preselectedAdvertiser={params.advertiser}
        preselectedType={params.type}
      />
    </div>
  );
}
