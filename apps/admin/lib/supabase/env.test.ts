import { afterEach, describe, expect, it } from 'vitest';
import { getPublicSupabaseConfig } from './env';

const originalPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
});

describe('Supabase public environment', () => {
  it('prefers the publishable key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-anon';

    expect(getPublicSupabaseConfig()).toEqual({
      url: 'https://project.supabase.co',
      key: 'sb_publishable_test',
    });
  });

  it('supports the legacy anon key fallback', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-anon';

    expect(getPublicSupabaseConfig().key).toBe('legacy-anon');
  });

  it('fails explicitly when public configuration is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(() => getPublicSupabaseConfig()).toThrow(
      'Configuração ausente: NEXT_PUBLIC_SUPABASE_URL',
    );
  });
});
