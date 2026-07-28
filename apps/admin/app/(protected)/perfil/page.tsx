import { redirect } from 'next/navigation';
import { updateProfile } from './actions';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');
  const params = await searchParams;
  return (
    <div className="page record-page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="MINHA CONTA"
        title="Perfil"
        description="Dados da sessão autenticada e papel autorizado."
      />
      <SectionCard>
        <form action={updateProfile} className="record-form">
          <label>
            Nome completo
            <input
              name="fullName"
              defaultValue={auth.profile.fullName}
              required
              maxLength={120}
            />
          </label>
          <label>
            E-mail
            <input value={auth.email} readOnly disabled />
          </label>
          <label>
            Perfil
            <input value={ROLE_LABELS[auth.profile.role]} readOnly disabled />
          </label>
          <div className="form-actions full-field">
            <button className="button button-primary" type="submit">
              Salvar perfil
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
