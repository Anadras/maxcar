import 'server-only';

import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/context';
import { reauthenticateWithPassword } from '@/lib/auth/reauth';
import { messageUrl } from '@/lib/forms';

export async function authorizePilotDelete(
  formData: FormData,
  returnPath: string,
) {
  const auth = await getAuthContext();
  if (!auth || auth.profile.role !== 'super_admin') {
    redirect(
      messageUrl(returnPath, 'error', 'Ação restrita ao superadministrador.'),
    );
  }
  const password = String(formData.get('password') ?? '');
  const confirmText = String(formData.get('confirmText') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (confirmText !== 'EXCLUIR') {
    redirect(messageUrl(returnPath, 'error', 'Digite EXCLUIR para confirmar.'));
  }
  if (!reason) {
    redirect(messageUrl(returnPath, 'error', 'Informe o motivo da exclusão.'));
  }
  if (!(await reauthenticateWithPassword(auth.email, password))) {
    redirect(messageUrl(returnPath, 'error', 'Senha atual incorreta.'));
  }
  return { auth, reason };
}
