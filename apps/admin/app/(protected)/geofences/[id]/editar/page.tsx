import { notFound, redirect } from 'next/navigation';
import { updateGeofence } from '../../actions';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceForm } from '@/components/geofence-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listGeoCampaignOptions } from '@/lib/data/campaigns';
import { getGeofence, listAllGeofencePlaces } from '@/lib/data/geofences';

export default async function EditGeofencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/geofences');
  const { id } = await params;
  const [query, geofence, campaigns, geofencePlaces] = await Promise.all([
    searchParams,
    getGeofence(id),
    listGeoCampaignOptions(),
    listAllGeofencePlaces(),
  ]);
  if (!geofence) notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="GEOFENCE"
        title={`Editar vínculo · ${geofence.geofence_name ?? geofence.establishment_name}`}
        description="A localização e o raio pertencem à geofence — para alterá-los, edite-a a partir do estabelecimento."
      />
      <SectionCard>
        <GeofenceForm
          geofence={geofence}
          campaigns={campaigns}
          geofencePlaces={geofencePlaces}
          action={updateGeofence.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
