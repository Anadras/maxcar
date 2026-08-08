import { notFound, redirect } from 'next/navigation';
import { updateGeofenceLocation } from '../../../../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceLocationForm } from '@/components/geofence-location-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getEstablishment } from '@/lib/data/establishments';
import { getGeofencePlace } from '@/lib/data/geofences';

export default async function EditGeofenceLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; geofenceId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  const { id, geofenceId } = await params;
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect(`/estabelecimentos/${id}`);
  const [query, establishment, geofence] = await Promise.all([
    searchParams,
    getEstablishment(id),
    getGeofencePlace(geofenceId),
  ]);
  if (!establishment || !geofence || geofence.establishment_id !== id)
    notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Estabelecimentos', href: '/estabelecimentos' },
          {
            label: establishment.name ?? 'Estabelecimento',
            href: `/estabelecimentos/${id}`,
          },
          { label: geofence.name ?? 'Geofence' },
        ]}
      />
      <PageHeader
        eyebrow="GEOFENCE"
        title={`Editar ${geofence.name}`}
        description={`Estabelecimento: ${establishment.name}`}
      />
      <SectionCard>
        <GeofenceLocationForm
          geofence={geofence}
          establishmentId={id}
          establishmentName={establishment.name ?? ''}
          action={updateGeofenceLocation.bind(null, geofenceId)}
        />
      </SectionCard>
    </div>
  );
}
