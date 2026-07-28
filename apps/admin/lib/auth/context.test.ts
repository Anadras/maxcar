import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import type { AppRole } from '@maxcar/shared';
import { getAuthContext } from './context';

function supabaseForProfile(role: AppRole, active: boolean) {
  const single = vi.fn().mockResolvedValue({
    data: { full_name: 'Admin MAXCAR', role, active },
    error: null,
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: {
          claims: {
            sub: 'user-id',
            email: 'admin@example.com',
          },
        },
        error: null,
      }),
    },
    from: vi.fn(() => ({ select })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticated profile context', () => {
  it.each([
    ['super_admin', true],
    ['pending', true],
    ['super_admin', false],
  ] as const)('loads %s with active=%s', async (role, active) => {
    mocks.createClient.mockResolvedValue(supabaseForProfile(role, active));

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-id',
      email: 'admin@example.com',
      profile: {
        fullName: 'Admin MAXCAR',
        role,
        active,
      },
    });
  });

  it('rejects a request without verified claims', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: null },
          error: new Error('missing session'),
        }),
      },
    });

    await expect(getAuthContext()).resolves.toBeNull();
  });
});
