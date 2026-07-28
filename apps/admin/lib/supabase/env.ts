function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Configuração ausente: ${name}. Consulte .env.example e docs/AUTH.md.`,
    );
  }
  return value;
}

export function getPublicSupabaseConfig() {
  return {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    key: required(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}
