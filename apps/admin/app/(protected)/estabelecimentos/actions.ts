'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { authorizePilotDelete } from '@/lib/pilot-delete';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { parseEstablishmentForm } from '@/lib/validation/establishments';
import { parseGeofenceLocationForm } from '@/lib/validation/geofences';

async function save(id: string | null, formData: FormData) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/estabelecimentos', 'error', 'Ação não autorizada.'));
  }
  const parsed = parseEstablishmentForm(formData);
  const formPath = id
    ? `/estabelecimentos/${id}/editar`
    : '/estabelecimentos/novo';
  if (!parsed.success) {
    redirect(
      messageUrl(
        formPath,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_establishment', {
    // Postgres accepts NULL here for create; generated RPC args omit nullability.
    p_id: id as string,
    p_advertiser_id: input.advertiserId,
    p_name: input.name,
    p_address_line: input.addressLine,
    p_number: input.number ?? '',
    p_complement: input.complement ?? '',
    p_neighborhood: input.neighborhood ?? '',
    p_city: input.city,
    p_state: input.state,
    p_postal_code: input.postalCode ?? '',
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_active: input.active,
  });
  if (error) {
    redirect(messageUrl(formPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath('/estabelecimentos');
  redirect(
    messageUrl(
      `/estabelecimentos/${data.id}`,
      'success',
      id ? 'Estabelecimento atualizado.' : 'Estabelecimento criado.',
    ),
  );
}

export async function createEstablishment(formData: FormData) {
  return save(null, formData);
}

export async function updateEstablishment(id: string, formData: FormData) {
  return save(id, formData);
}

async function saveGeofenceLocation(id: string | null, formData: FormData) {
  const auth = await getAuthContext();
  if (!auth || !canWriteCommercialData(auth.profile.role)) {
    redirect(messageUrl('/estabelecimentos', 'error', 'Ação não autorizada.'));
  }
  const parsed = parseGeofenceLocationForm(formData);
  const establishmentId = String(formData.get('establishmentId') ?? '');
  const formPath = id
    ? `/estabelecimentos/${establishmentId}/geofences/${id}/editar`
    : `/estabelecimentos/${establishmentId}/geofences/nova`;
  if (!parsed.success) {
    redirect(
      messageUrl(
        formPath,
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_geofence', {
    // Postgres accepts NULL here for create; generated RPC args omit nullability.
    p_id: id as string,
    p_establishment_id: input.establishmentId,
    p_name: input.name,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_radius_meters: input.radiusMeters,
    p_active: input.active,
  });
  if (error) {
    redirect(messageUrl(formPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath(`/estabelecimentos/${input.establishmentId}`);
  redirect(
    messageUrl(
      `/estabelecimentos/${input.establishmentId}`,
      'success',
      id ? 'Geofence atualizada.' : 'Geofence criada.',
    ),
  );
}

export async function createGeofenceLocation(formData: FormData) {
  return saveGeofenceLocation(null, formData);
}

export async function updateGeofenceLocation(id: string, formData: FormData) {
  return saveGeofenceLocation(id, formData);
}

export async function deleteEstablishmentPermanently(
  id: string,
  advertiserId: string,
  formData: FormData,
) {
  const returnPath = `/estabelecimentos/${id}`;
  const { reason } = await authorizePilotDelete(formData, returnPath);
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_establishment_permanently', {
    p_id: id,
    p_reason: reason,
  });
  if (error) {
    redirect(messageUrl(returnPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath('/clientes');
  revalidatePath(`/clientes/${advertiserId}`);
  redirect(
    messageUrl(
      `/clientes/${advertiserId}`,
      'success',
      'Estabelecimento excluído.',
    ),
  );
}
