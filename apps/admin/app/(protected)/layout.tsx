import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { destinationForProfile } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');
  const destination = destinationForProfile(
    auth.profile.role,
    auth.profile.active,
  );
  if (destination !== '/') redirect(destination);

  return (
    <AppShell
      user={{
        name: auth.profile.fullName,
        email: auth.email,
        role: auth.profile.role,
      }}
      environment={process.env.NEXT_PUBLIC_APP_ENV ?? 'development'}
    >
      {children}
    </AppShell>
  );
}
