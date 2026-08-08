import { redirect } from 'next/navigation';
import { createGeofence } from '../actions';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceForm } from '@/components/geofence-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listGeoCampaignOptions } from '@/lib/data/campaigns';
import { listAllGeofencePlaces } from '@/lib/data/geofences';

export default async function NewGeofencePage({
  searchParams,
}: {
  searchParams: Promise<{
    campaign?: string;
    geofence?: string;
    error?: string;
  }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/geofences');
  const [params, campaigns, geofencePlaces] = await Promise.all([
    searchParams,
    listGeoCampaignOptions(),
    listAllGeofencePlaces(),
  ]);
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="NOVA GEOFENCE"
        title="Vincular geofence a uma campanha"
        description="Selecione a campanha GEO e uma geofence já cadastrada no estabelecimento do mesmo cliente."
      />
      <SectionCard>
        <GeofenceForm
          campaigns={campaigns}
          geofencePlaces={geofencePlaces}
          preselectedCampaign={params.campaign}
          preselectedGeofence={params.geofence}
          action={createGeofence}
        />
      </SectionCard>
    </div>
  );
}
