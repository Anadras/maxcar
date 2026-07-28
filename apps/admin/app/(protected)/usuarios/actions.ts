'use server';

import type { AppRole } from '@maxcar/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { canManageUsers } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { messageUrl, optionalText } from '@/lib/forms';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const inviteSchema = z.object({
  email: z.email('Informe um e-mail válido.'),
  fullName: z.string().trim().min(2, 'Informe o nome.').max(120),
});
const roleSchema = z.enum([
  'pending',
  'super_admin',
  'admin',
  'commercial',
  'operations',
  'advertiser',
  'driver',
]);

async function actor() {
  const auth = await getAuthContext();
  if (!auth || !canManageUsers(auth.profile.role)) redirect('/');
  return auth;
}

export async function inviteUser(formData: FormData) {
  await actor();
  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
  });
  if (!parsed.success) {
    redirect(
      messageUrl(
        '/usuarios',
        'error',
        parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      ),
    );
  }
  const admin = createAdminClient();
  if (!admin) {
    redirect(
      messageUrl(
        '/usuarios',
        'error',
        'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para enviar convites.',
      ),
    );
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(
    parsed.data.email,
    { data: { full_name: parsed.data.fullName } },
  );
  if (error) redirect(messageUrl('/usuarios', 'error', error.message));
  revalidatePath('/usuarios');
  redirect(
    messageUrl('/usuarios', 'success', 'Convite enviado com segurança.'),
  );
}

export async function updateManagedUser(id: string, formData: FormData) {
  const auth = await actor();
  if (id === auth.userId) {
    redirect(
      messageUrl(
        '/usuarios',
        'error',
        'Sua própria permissão deve ser alterada por outro administrador.',
      ),
    );
  }
  const parsedRole = roleSchema.safeParse(formData.get('role'));
  if (!parsedRole.success) {
    redirect(messageUrl('/usuarios', 'error', 'Perfil inválido.'));
  }
  const role: AppRole = parsedRole.data;
  if (role === 'super_admin' && auth.profile.role !== 'super_admin') {
    redirect(
      messageUrl(
        '/usuarios',
        'error',
        'Somente um superadministrador pode conceder esse perfil.',
      ),
    );
  }
  const advertiserId = optionalText(formData.get('advertiserId'));
  const driverId = optionalText(formData.get('driverId'));
  if (role === 'advertiser' && !advertiserId) {
    redirect(
      messageUrl('/usuarios', 'error', 'Informe o ID do anunciante vinculado.'),
    );
  }
  if (role === 'driver' && !driverId) {
    redirect(
      messageUrl('/usuarios', 'error', 'Informe o ID do motorista vinculado.'),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({
      role,
      active: formData.get('active') === 'on',
      advertiser_id: role === 'advertiser' ? advertiserId : null,
      driver_id: role === 'driver' ? driverId : null,
    })
    .eq('id', id)
    .select('id')
    .single();
  if (error) redirect(messageUrl('/usuarios', 'error', error.message));
  revalidatePath('/usuarios');
  redirect(messageUrl('/usuarios', 'success', 'Usuário atualizado.'));
}
