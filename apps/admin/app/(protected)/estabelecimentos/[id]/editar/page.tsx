import { notFound, redirect } from 'next/navigation';
import { updateEstablishment } from '../../actions';
import { EstablishmentForm } from '@/components/establishment-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listAdvertisers } from '@/lib/data/advertisers';
import { getEstablishment } from '@/lib/data/establishments';

export default async function EditEstablishmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/estabelecimentos');
  const { id } = await params;
  const [query, item, advertisers] = await Promise.all([
    searchParams,
    getEstablishment(id),
    listAdvertisers(),
  ]);
  if (!item) notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="ESTABELECIMENTO"
        title={`Editar ${item.name}`}
        description="Atualize o endereço, status ou coordenadas."
      />
      <SectionCard>
        <EstablishmentForm
          establishment={item}
          advertisers={advertisers}
          action={updateEstablishment.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
