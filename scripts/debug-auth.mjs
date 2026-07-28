import { createServerClient } from '@supabase/ssr';
import { resolve } from 'node:path';
import process from 'node:process';

process.loadEnvFile(resolve('apps/admin/.env.local'));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.AUTH_DIAGNOSTIC_EMAIL;
const password = process.env.AUTH_DIAGNOSTIC_PASSWORD;

if (!url || !key) {
  console.error('Auth diagnostic: configuração pública ausente.');
  process.exitCode = 1;
} else {
  const cookies = [];
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => cookies,
      setAll: (values) => {
        cookies.splice(0, cookies.length, ...values);
      },
    },
  });

  console.info('Auth diagnostic configuration', {
    host: new URL(url).host,
    keyKind: key.startsWith('sb_publishable_')
      ? 'sb_publishable_'
      : key.startsWith('eyJ')
        ? 'legacy-jwt'
        : 'unexpected',
    credentialsProvided: Boolean(email && password),
  });

  if (email && password) {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Auth diagnostic sign-in', {
        ok: false,
        code: error.code ?? null,
        message: error.message,
        name: error.name,
        status: error.status ?? null,
      });
      process.exitCode = 1;
    } else {
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('role, active')
        .eq('id', data.user.id)
        .single();

      console.info('Auth diagnostic sign-in', {
        ok: true,
        cookieCount: cookies.length,
        userPresent: Boolean(data.user.id),
        profile: profileError
          ? { ok: false, code: profileError.code }
          : { ok: true, role: profile.role, active: profile.active },
      });
    }
  }
}
