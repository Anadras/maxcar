import { redirect } from 'next/navigation';
import { createDevice } from '../actions';
import { DeviceForm } from '@/components/device-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listVehicleOptions } from '@/lib/data/vehicles';

export default async function NewDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/dispositivos');
  const [params, vehicles] = await Promise.all([
    searchParams,
    listVehicleOptions(),
  ]);
  return (
    <div className="page record-page">
      <FlashMessage error={params.error} />
      <PageHeader
        eyebrow="MONITORAMENTO DA FROTA"
        title="Novo dispositivo"
        description="Cadastre o código operacional e o vínculo inicial."
      />
      <SectionCard>
        <DeviceForm vehicles={vehicles} action={createDevice} />
      </SectionCard>
    </div>
  );
}
