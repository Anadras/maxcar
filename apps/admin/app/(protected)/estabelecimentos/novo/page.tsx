import { redirect } from 'next/navigation';
import { createEstablishment } from '../actions';
import { EstablishmentForm } from '@/components/establishment-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listAdvertisers } from '@/lib/data/advertisers';

export default async function NewEstablishmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/estabelecimentos');
  const [params, advertisers] = await Promise.all([
    searchParams,
    listAdvertisers(),
  ]);
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="PONTO DE ATIVAÇÃO"
        title="Novo estabelecimento"
        description="Cadastre o endereço e o ponto geográfico da unidade."
      />
      <SectionCard>
        <EstablishmentForm
          advertisers={advertisers}
          action={createEstablishment}
        />
      </SectionCard>
    </div>
  );
}
