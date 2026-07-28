function required(name: string, value?: string) {
  if (!value) {
    throw new Error(
      `Configuração ausente: ${name}. Consulte .env.example e docs/AUTH.md.`,
    );
  }
  return value;
}

export function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    url: required('NEXT_PUBLIC_SUPABASE_URL', url),
    key: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', publishableKey),
  };
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}
