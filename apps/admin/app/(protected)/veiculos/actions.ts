'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl, optionalText } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { parseVehicleForm } from '@/lib/validation/vehicles';

async function authorize(path: string) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role))
    redirect(messageUrl(path, 'error', 'Ação não autorizada.'));
}

function vehiclePayload(input: ReturnType<typeof parseVehicleForm>['data']) {
  if (!input) throw new Error('Invalid vehicle payload.');
  return {
    internal_code: input.internalCode,
    license_plate: optionalText(input.licensePlate ?? null),
    make: optionalText(input.make ?? null),
    model: optionalText(input.model ?? null),
    year: input.year === '' || input.year === undefined ? null : input.year,
    driver_id: optionalText(input.driverId ?? null),
    status: input.status,
  };
}

export async function createVehicle(formData: FormData) {
  await authorize('/veiculos');
  const parsed = parseVehicleForm(formData);
  if (!parsed.success)
    redirect(
      messageUrl(
        '/veiculos/novo',
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicles')
    .insert(vehiclePayload(parsed.data))
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl('/veiculos/novo', 'error', friendlyDatabaseError(error)),
    );
  revalidatePath('/veiculos');
  revalidatePath('/motoristas');
  redirect(messageUrl(`/veiculos/${data.id}`, 'success', 'Veículo criado.'));
}

export async function updateVehicle(id: string, formData: FormData) {
  await authorize(`/veiculos/${id}`);
  const parsed = parseVehicleForm(formData);
  if (!parsed.success)
    redirect(
      messageUrl(
        `/veiculos/${id}/editar`,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  const supabase = await createClient();
  const { error } = await supabase
    .from('vehicles')
    .update(vehiclePayload(parsed.data))
    .eq('id', id)
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl(
        `/veiculos/${id}/editar`,
        'error',
        friendlyDatabaseError(error),
      ),
    );
  revalidatePath('/veiculos');
  revalidatePath('/motoristas');
  revalidatePath('/dispositivos');
  redirect(messageUrl(`/veiculos/${id}`, 'success', 'Veículo atualizado.'));
}
