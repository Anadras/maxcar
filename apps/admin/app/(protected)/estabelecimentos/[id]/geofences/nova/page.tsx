import { notFound, redirect } from 'next/navigation';
import { createGeofenceLocation } from '../../../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceLocationForm } from '@/components/geofence-location-form';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getEstablishment } from '@/lib/data/establishments';

export default async function NewGeofenceLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  const { id } = await params;
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect(`/estabelecimentos/${id}`);
  const [query, establishment] = await Promise.all([
    searchParams,
    getEstablishment(id),
  ]);
  if (!establishment) notFound();
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
          { label: 'Nova geofence' },
        ]}
      />
      <PageHeader
        eyebrow="NOVA GEOFENCE"
        title={`Criar geofence em ${establishment.name}`}
        description="Defina o ponto e o raio deste local — depois vincule a uma ou mais campanhas GEO."
      />
      <SectionCard>
        <GeofenceLocationForm
          establishmentId={id}
          establishmentName={establishment.name ?? ''}
          action={createGeofenceLocation}
        />
      </SectionCard>
    </div>
  );
}
