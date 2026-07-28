import { redirect } from 'next/navigation';
import { logout } from '@/app/(auth)/actions';
import { getAuthContext } from '@/lib/auth/context';
import { destinationForProfile } from '@/lib/auth/access';

export default async function UnavailablePage() {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');
  const destination = destinationForProfile(
    auth.profile.role,
    auth.profile.active,
  );
  if (destination !== '/acesso-indisponivel') redirect(destination);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">ACESSO CONTROLADO</p>
        <h1>Painel indisponível para este perfil</h1>
        <p>
          Sua conta está inativa ou este tipo de usuário ainda não possui uma
          experiência administrativa. Fale com um administrador da MAXCAR.
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
