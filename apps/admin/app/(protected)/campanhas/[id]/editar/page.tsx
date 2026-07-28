import { notFound, redirect } from 'next/navigation';
import { updateCampaign } from '../../actions';
import { CampaignForm } from '@/components/campaign-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listAdvertisers } from '@/lib/data/advertisers';
import { getCampaign } from '@/lib/data/campaigns';

export default async function EditCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/campanhas');
  const { id } = await params;
  const [query, campaign, advertisers] = await Promise.all([
    searchParams,
    getCampaign(id),
    listAdvertisers(),
  ]);
  if (!campaign) notFound();
  return (
    <div className="page campaign-editor">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="CAMPANHA"
        title={`Editar ${campaign.name}`}
        description="Atualize a programação e ative apenas quando a estrutura estiver pronta."
      />
      <CampaignForm
        campaign={campaign}
        advertisers={advertisers}
        action={updateCampaign.bind(null, id)}
      />
    </div>
  );
}
