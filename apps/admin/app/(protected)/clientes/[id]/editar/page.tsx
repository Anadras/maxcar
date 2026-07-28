import { notFound, redirect } from 'next/navigation';
import { updateAdvertiser } from '../../actions';
import { AdvertiserForm } from '@/components/advertiser-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getAdvertiser } from '@/lib/data/advertisers';

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/clientes');
  const { id } = await params;
  const query = await searchParams;
  const client = await getAdvertiser(id);
  if (!client) notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="CLIENTE"
        title={`Editar ${client.trade_name}`}
        description="Atualize os dados comerciais e o status."
      />
      <SectionCard>
        <AdvertiserForm
          advertiser={client}
          action={updateAdvertiser.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
