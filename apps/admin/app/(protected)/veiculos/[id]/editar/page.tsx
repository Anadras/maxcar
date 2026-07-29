import { notFound, redirect } from 'next/navigation';
import { updateVehicle } from '../../actions';
import { VehicleForm } from '@/components/vehicle-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listDriverOptions } from '@/lib/data/drivers';
import { getVehicle } from '@/lib/data/vehicles';

export default async function EditVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/veiculos');
  const { id } = await params;
  const [query, vehicle] = await Promise.all([searchParams, getVehicle(id)]);
  if (!vehicle) notFound();
  const drivers = await listDriverOptions(vehicle.driver_id);
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="VEÍCULO"
        title={`Editar ${vehicle.internal_code}`}
        description="Atualize cadastro, status e motorista vinculado."
      />
      <SectionCard>
        <VehicleForm
          vehicle={vehicle}
          drivers={drivers}
          action={updateVehicle.bind(null, id)}
        />
      </SectionCard>
    </div>
  );
}
