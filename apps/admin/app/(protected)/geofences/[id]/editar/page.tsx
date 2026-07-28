import { notFound, redirect } from 'next/navigation';
import { updateGeofence } from '../../actions';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceForm } from '@/components/geofence-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listGeoCampaignOptions } from '@/lib/data/campaigns';
import { listEstablishments } from '@/lib/data/establishments';
import { getGeofence } from '@/lib/data/geofences';

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
  const [query, geofence, campaigns, establishments] = await Promise.all([
    searchParams,
    getGeofence(id),
    listGeoCampaignOptions(),
    listEstablishments(),
  ]);
  if (!geofence) notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="GEOFENCE"
        title={`Editar ${geofence.establishment_name}`}
        description="A localização permanece vinculada ao estabelecimento."
      />
      <SectionCard>
        <GeofenceForm
          geofence={geofence}
          campaigns={campaigns}
          establishments={establishments}
          action={updateGeofence.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
