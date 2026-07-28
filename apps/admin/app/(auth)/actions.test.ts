import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  logAuthAttempt: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/diagnostics', () => ({
  logAuthAttempt: mocks.logAuthAttempt,
}));
vi.mock('@/lib/supabase/env', () => ({
  getPublicSupabaseConfig: () => ({
    url: 'https://project.supabase.co',
    key: 'sb_publishable_test',
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { login } from './actions';

function loginForm(email: string, password: string) {
  const formData = new FormData();
  formData.set('email', email);
  formData.set('password', password);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login Server Action', () => {
  it('rejects an incomplete form before contacting Supabase', async () => {
    await expect(login({}, loginForm('', ''))).resolves.toEqual({
      error: 'Informe e-mail e senha.',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('preserves password bytes and returns a generic credential error', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        status: 400,
      },
    });
    mocks.createClient.mockResolvedValue({
      auth: { signInWithPassword },
    });

    await expect(
      login({}, loginForm('  ADMIN@example.com ', ' password with spaces ')),
    ).resolves.toEqual({ error: 'E-mail ou senha inválidos.' });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ADMIN@example.com',
      password: ' password with spaces ',
    });
    expect(mocks.logAuthAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ADMIN@example.com',
        passwordLength: 22,
      }),
    );
  });

  it('keeps unexpected Supabase errors private from the browser', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          error: {
            code: 'unexpected_failure',
            message: 'Internal provider detail',
            status: 503,
          },
        }),
      },
    });

    await expect(
      login({}, loginForm('admin@example.com', 'password')),
    ).resolves.toEqual({ error: 'E-mail ou senha inválidos.' });
  });

  it('redirects after a successful login', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    await expect(
      login({}, loginForm('admin@example.com', 'password')),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/');
    expect(mocks.logAuthAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ error: null }),
    );
  });
});
