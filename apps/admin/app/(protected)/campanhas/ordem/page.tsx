import { PageHeader, SectionCard } from '@/components/ui';
import { listDefaultPlaylistCampaigns } from '@/lib/data/campaigns';
import { CampaignTabs } from '../campaign-tabs';
import { ReorderList } from './reorder-list';

export default async function CampaignOrderPage() {
  const campaigns = await listDefaultPlaylistCampaigns();

  return (
    <div className="page">
      <PageHeader
        eyebrow="PUBLICIDADE"
        title="Ordem de exibição"
        description="Defina a sequência de reprodução das campanhas REGULAR no piloto."
      />
      <CampaignTabs active="ordem" />
      <SectionCard title="Grade REGULAR do piloto" subtitle="Arraste para reordenar">
        <ReorderList
          initialRows={campaigns.map((campaign) => ({
            campaignId: campaign.campaignId,
            name: campaign.name,
            advertiserName: campaign.advertiserName,
            status: campaign.status,
          }))}
        />
      </SectionCard>
    </div>
  );
}
