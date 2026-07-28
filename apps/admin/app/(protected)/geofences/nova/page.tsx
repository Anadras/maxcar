import { redirect } from 'next/navigation';
import { createGeofence } from '../actions';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceForm } from '@/components/geofence-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listGeoCampaignOptions } from '@/lib/data/campaigns';
import { listEstablishments } from '@/lib/data/establishments';

export default async function NewGeofencePage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/geofences');
  const [params, campaigns, establishments] = await Promise.all([
    searchParams,
    listGeoCampaignOptions(),
    listEstablishments(),
  ]);
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="NOVA GEOFENCE"
        title="Associar zona de ativação"
        description="Selecione campanha e estabelecimento do mesmo cliente."
      />
      <SectionCard>
        <GeofenceForm
          campaigns={campaigns}
          establishments={establishments}
          preselectedCampaign={params.campaign}
          action={createGeofence}
        />
      </SectionCard>
    </div>
  );
}
