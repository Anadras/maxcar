import { redirect } from 'next/navigation';
import { createDriver } from '../actions';
import { DriverForm } from '@/components/driver-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';

export default async function NewDriverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/motoristas');
  const params = await searchParams;
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="OPERAÇÃO DE FROTA"
        title="Novo motorista"
        description="Cadastre a pessoa antes de vinculá-la a um veículo."
      />
      <SectionCard>
        <DriverForm action={createDriver} />
      </SectionCard>
    </div>
  );
}
