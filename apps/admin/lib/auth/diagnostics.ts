import 'server-only';

interface AuthErrorDetails {
  code?: string;
  message: string;
  name?: string;
  status?: number;
}

export interface AuthAttemptDiagnostic {
  email: string;
  error?: AuthErrorDetails | null;
  key: string;
  passwordLength: number;
  url: string;
}

export function publicKeyKind(key: string) {
  if (key.startsWith('sb_publishable_')) return 'sb_publishable_';
  if (key.startsWith('eyJ')) return 'legacy-jwt';
  return 'unexpected';
}

export function logAuthAttempt({
  email,
  error,
  key,
  passwordLength,
  url,
}: AuthAttemptDiagnostic) {
  if (process.env.NODE_ENV === 'production') return;

  let supabaseUrl = 'invalid-url';
  try {
    supabaseUrl = new URL(url).origin;
  } catch {
    // The configuration validator will expose a missing/invalid URL separately.
  }

  console.info('[maxcar:auth]', {
    email,
    passwordLength,
    supabaseUrl,
    publicKeyKind: publicKeyKind(key),
    result: error
      ? {
          code: error.code ?? null,
          message: error.message,
          name: error.name ?? null,
          status: error.status ?? null,
        }
      : 'success',
  });
}
