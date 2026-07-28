import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('./env', () => ({
  getPublicSupabaseConfig: () => ({
    url: 'https://project.supabase.co',
    key: 'sb_publishable_test',
  }),
}));

import type { CookieOptions } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { updateSession } from './proxy';

interface ServerCookieOptions {
  cookies: {
    setAll: (
      values: Array<{ name: string; value: string; options: CookieOptions }>,
      headers: Record<string, string>,
    ) => void;
  };
}

function mockClaims(claims: { sub: string } | null, refreshSession = false) {
  mocks.createServerClient.mockImplementation(
    (_url: string, _key: string, options: ServerCookieOptions) => ({
      auth: {
        getClaims: async () => {
          if (refreshSession) {
            options.cookies.setAll(
              [
                {
                  name: 'sb-session',
                  value: 'safe-test-value',
                  options: { path: '/', sameSite: 'lax' },
                },
              ],
              { 'Cache-Control': 'private, no-store' },
            );
          }
          return { data: { claims }, error: null };
        },
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Supabase session proxy', () => {
  it('keeps login public without a session', async () => {
    mockClaims(null);
    const response = await updateSession(
      new NextRequest('http://localhost:3000/login'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects protected requests to login with the intended destination', async () => {
    mockClaims(null);
    const response = await updateSession(
      new NextRequest('http://localhost:3000/campanhas?status=active'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fcampanhas%3Fstatus%3Dactive',
    );
  });

  it('preserves refreshed cookies and no-cache headers across redirects', async () => {
    mockClaims({ sub: 'user-id' }, true);
    const response = await updateSession(
      new NextRequest('http://localhost:3000/login'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/');
    expect(response.cookies.get('sb-session')?.value).toBe('safe-test-value');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
