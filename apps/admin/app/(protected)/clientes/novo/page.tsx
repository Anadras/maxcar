import { redirect } from 'next/navigation';
import { createAdvertiser } from '../actions';
import { AdvertiserForm } from '@/components/advertiser-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role))
    redirect('/clientes');
  const params = await searchParams;
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="RELACIONAMENTO COMERCIAL"
        title="Novo cliente"
        description="Cadastre os dados comerciais do anunciante."
      />
      <SectionCard>
        <AdvertiserForm action={createAdvertiser} />
      </SectionCard>
    </div>
  );
}
