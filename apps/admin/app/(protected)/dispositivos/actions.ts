'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl, optionalText } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  parseDeviceForm,
  parseHeartbeatSimulation,
} from '@/lib/validation/devices';

async function authorize(path: string) {
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role))
    redirect(messageUrl(path, 'error', 'Ação não autorizada.'));
  return auth;
}

function devicePayload(input: ReturnType<typeof parseDeviceForm>['data']) {
  if (!input) throw new Error('Invalid device payload.');
  return {
    device_code: input.deviceCode,
    vehicle_id: optionalText(input.vehicleId ?? null),
    status: input.status,
    app_version: optionalText(input.appVersion ?? null),
  };
}

export async function createDevice(formData: FormData) {
  await authorize('/dispositivos');
  const parsed = parseDeviceForm(formData);
  if (!parsed.success)
    redirect(
      messageUrl(
        '/dispositivos/novo',
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('devices')
    .insert(devicePayload(parsed.data))
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl('/dispositivos/novo', 'error', friendlyDatabaseError(error)),
    );
  revalidatePath('/dispositivos');
  revalidatePath('/veiculos');
  redirect(
    messageUrl(`/dispositivos/${data.id}`, 'success', 'Dispositivo criado.'),
  );
}

export async function updateDevice(id: string, formData: FormData) {
  await authorize(`/dispositivos/${id}`);
  const parsed = parseDeviceForm(formData);
  if (!parsed.success)
    redirect(
      messageUrl(
        `/dispositivos/${id}/editar`,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  const supabase = await createClient();
  const { error } = await supabase
    .from('devices')
    .update(devicePayload(parsed.data))
    .eq('id', id)
    .select('id')
    .single();
  if (error)
    redirect(
      messageUrl(
        `/dispositivos/${id}/editar`,
        'error',
        friendlyDatabaseError(error),
      ),
    );
  revalidatePath('/dispositivos');
  revalidatePath('/veiculos');
  redirect(
    messageUrl(`/dispositivos/${id}`, 'success', 'Dispositivo atualizado.'),
  );
}

export async function simulateHeartbeat(formData: FormData) {
  const fallbackId = String(formData.get('deviceId') ?? '');
  const auth = await authorize(`/dispositivos/${fallbackId}`);
  if (
    process.env.NODE_ENV === 'production' ||
    auth.profile.role !== 'super_admin'
  ) {
    redirect(
      messageUrl(
        `/dispositivos/${fallbackId}`,
        'error',
        'Simulação disponível apenas para superadministradores em desenvolvimento.',
      ),
    );
  }
  const parsed = parseHeartbeatSimulation(formData);
  if (!parsed.success)
    redirect(
      messageUrl(
        `/dispositivos/${fallbackId}`,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  const input = parsed.data;
  const supabase = await createClient();
  const simulate = supabase.rpc.bind(supabase) as unknown as (
    functionName: 'simulate_device_heartbeat',
    args: {
      p_device_id: string;
      p_battery_level: number;
      p_network_connected: boolean;
      p_gps_available: boolean;
      p_storage_free_bytes: number;
      p_app_version: string;
      p_latitude: number;
      p_longitude: number;
    },
  ) => Promise<{ error: { message: string; code?: string } | null }>;
  const { error } = await simulate('simulate_device_heartbeat', {
    p_device_id: input.deviceId,
    p_battery_level: input.batteryLevel,
    p_network_connected: input.networkConnected,
    p_gps_available: input.gpsAvailable,
    p_storage_free_bytes: 16_000_000_000,
    p_app_version: '1.0.0-dev',
    p_latitude: input.latitude,
    p_longitude: input.longitude,
  });
  if (error)
    redirect(
      messageUrl(
        `/dispositivos/${input.deviceId}`,
        'error',
        friendlyDatabaseError(error),
      ),
    );
  revalidatePath('/');
  revalidatePath('/dispositivos');
  revalidatePath(`/dispositivos/${input.deviceId}`);
  redirect(
    messageUrl(
      `/dispositivos/${input.deviceId}`,
      'success',
      'Heartbeat simulado e persistido.',
    ),
  );
}
