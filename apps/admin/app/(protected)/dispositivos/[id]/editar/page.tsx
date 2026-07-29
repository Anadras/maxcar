import { notFound, redirect } from 'next/navigation';
import { updateDevice } from '../../actions';
import { DeviceForm } from '@/components/device-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDevice } from '@/lib/data/devices';
import { listVehicleOptions } from '@/lib/data/vehicles';

export default async function EditDevicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/dispositivos');
  const { id } = await params;
  const [query, device] = await Promise.all([searchParams, getDevice(id)]);
  if (!device) notFound();
  const vehicles = await listVehicleOptions(device.vehicle_id);
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="DISPOSITIVO"
        title={`Editar ${device.device_code}`}
        description="Atualize cadastro, ciclo e veículo vinculado."
      />
      <SectionCard>
        <DeviceForm
          device={device}
          vehicles={vehicles}
          action={updateDevice.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
