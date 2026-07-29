import { campaignReadinessIssues } from '@maxcar/business-rules';
import { notFound, redirect } from 'next/navigation';
import { updateCampaign } from '../../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CampaignForm } from '@/components/campaign-form';
import { FlashMessage } from '@/components/flash-message';
import { ReadinessBanner } from '@/components/readiness-banner';
import { PageHeader } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listAdvertisers } from '@/lib/data/advertisers';
import { getCampaign } from '@/lib/data/campaigns';
import { listCampaignCreatives } from '@/lib/data/creatives';
import { listCampaignGeofences } from '@/lib/data/geofences';

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
  const [query, campaign, advertisers, creatives, geofences] =
    await Promise.all([
      searchParams,
      getCampaign(id),
      listAdvertisers(),
      listCampaignCreatives(id),
      listCampaignGeofences(id),
    ]);
  if (!campaign || !campaign.campaign_type) notFound();
  const readiness = campaignReadinessIssues({
    campaignType: campaign.campaign_type,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    dailyStartTime: campaign.daily_start_time,
    dailyEndTime: campaign.daily_end_time,
    activeDays: campaign.active_days ?? [],
    activeCreativeCount: creatives.filter((item) => item.active).length,
    activeGeofenceCount: geofences.filter((item) => item.active).length,
  });
  return (
    <div className="page campaign-editor">
      <FlashMessage error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Campanhas', href: '/campanhas' },
          { label: campaign.name ?? 'Campanha', href: `/campanhas/${id}` },
          { label: 'Editar' },
        ]}
      />
      <PageHeader
        eyebrow="CAMPANHA"
        title={`Editar ${campaign.name}`}
        description="Atualize a programação e ative apenas quando a estrutura estiver pronta."
      />
      <ReadinessBanner ready={readiness.length === 0} issues={readiness} />
      <CampaignForm
        campaign={campaign}
        advertisers={advertisers}
        action={updateCampaign.bind(null, id)}
      />
    </div>
  );
}
