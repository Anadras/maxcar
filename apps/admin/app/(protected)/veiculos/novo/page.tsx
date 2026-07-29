import { redirect } from 'next/navigation';
import { createVehicle } from '../actions';
import { VehicleForm } from '@/components/vehicle-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listDriverOptions } from '@/lib/data/drivers';

export default async function NewVehiclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/veiculos');
  const [params, drivers] = await Promise.all([
    searchParams,
    listDriverOptions(),
  ]);
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="OPERAÇÃO DE FROTA"
        title="Novo veículo"
        description="Cadastre o veículo e, se disponível, vincule um motorista."
      />
      <SectionCard>
        <VehicleForm drivers={drivers} action={createVehicle} />
      </SectionCard>
    </div>
  );
}
