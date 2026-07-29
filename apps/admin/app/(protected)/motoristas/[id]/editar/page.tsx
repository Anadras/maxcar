import { notFound, redirect } from 'next/navigation';
import { updateDriver } from '../../actions';
import { DriverForm } from '@/components/driver-form';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDriver } from '@/lib/data/drivers';

export default async function EditDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) redirect('/motoristas');
  const { id } = await params;
  const query = await searchParams;
  const driver = await getDriver(id);
  if (!driver) notFound();
  return (
    <div className="page record-page">
      <FlashMessage error={query.error} />
      <PageHeader
        eyebrow="MOTORISTA"
        title={`Editar ${driver.full_name}`}
        description="Atualize os dados e o estado operacional."
      />
      <SectionCard>
        <DriverForm driver={driver} action={updateDriver.bind(null, id)} />
      </SectionCard>
    </div>
  );
}
