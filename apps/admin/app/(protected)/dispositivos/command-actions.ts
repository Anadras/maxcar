'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { friendlyDatabaseError, messageUrl } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import type { DeviceCommandType } from '@maxcar/shared';

const COMMAND_LABEL: Record<DeviceCommandType, string> = {
  sync_now: 'Sincronizar agora',
  restart_player: 'Reiniciar player',
  clear_obsolete_media: 'Limpar mídia obsoleta',
  enter_maintenance: 'Entrar em manutenção',
  exit_maintenance: 'Sair da manutenção',
  update_config: 'Atualizar configuração',
  enable_kiosk: 'Ativar quiosque',
  disable_kiosk_temporarily: 'Suspender quiosque temporariamente',
  reenter_kiosk: 'Retomar quiosque agora',
};

export async function issueDeviceCommand(id: string, formData: FormData) {
  const detailPath = `/dispositivos/${id}`;
  const auth = await getAuthContext();
  if (!auth || !canManageFleet(auth.profile.role)) {
    redirect(messageUrl(detailPath, 'error', 'Ação não autorizada.'));
  }

  const commandType = String(
    formData.get('commandType') ?? '',
  ) as DeviceCommandType;
  if (!(commandType in COMMAND_LABEL)) {
    redirect(messageUrl(detailPath, 'error', 'Comando inválido.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_device_command', {
    p_device_id: id,
    p_command_type: commandType,
  });
  if (error) {
    redirect(messageUrl(detailPath, 'error', friendlyDatabaseError(error)));
  }
  revalidatePath(detailPath);
  redirect(
    messageUrl(
      detailPath,
      'success',
      `Comando "${COMMAND_LABEL[commandType]}" enviado. Será entregue no próximo ciclo de sincronização do tablet.`,
    ),
  );
}
