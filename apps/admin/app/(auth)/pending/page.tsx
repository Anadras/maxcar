import { redirect } from 'next/navigation';
import { logout } from '@/app/(auth)/actions';
import { getAuthContext } from '@/lib/auth/context';
import { destinationForProfile } from '@/lib/auth/access';

export default async function PendingPage() {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');
  const destination = destinationForProfile(
    auth.profile.role,
    auth.profile.active,
  );
  if (destination !== '/pending') redirect(destination);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">CONTA RECEBIDA</p>
        <h1>Aguardando aprovação</h1>
        <p>
          Olá, {auth.profile.fullName}. Um administrador precisa definir seu
          perfil antes que o painel seja liberado.
        </p>
        <form action={logout}>
          <button className="button button-secondary" type="submit">
            Sair
          </button>
        </form>
      </section>
    </main>
  );
}
