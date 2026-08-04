'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

export async function setDeviceMaintenancePin(id: string, formData: FormData) {
  const detailPath = `/dispositivos/${id}`;
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') {
    redirect(
      messageUrl(
        detailPath,
        'error',
        'Apenas superadministradores podem definir o PIN de manutenção.',
      ),
    );
  }

  const pin = String(formData.get('pin') ?? '').trim();
  const confirmPin = String(formData.get('confirmPin') ?? '').trim();
  if (pin !== confirmPin) {
    redirect(
      messageUrl(detailPath, 'error', 'Os PINs digitados não coincidem.'),
    );
  }
  if (!/^[0-9]{4,8}$/.test(pin)) {
    redirect(
      messageUrl(detailPath, 'error', 'O PIN deve ter de 4 a 8 dígitos.'),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_device_maintenance_pin', {
    p_device_id: id,
    p_pin: pin,
  });
  if (error) {
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      'PIN de manutenção definido. Será entregue ao tablet no próximo ciclo de sincronização.',
    ),
  );
}
