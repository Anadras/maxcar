import { describe, expect, it } from 'vitest';
import {
  canManageUsers,
  canWriteCommercialData,
  destinationForProfile,
} from './access';

describe('profile routing', () => {
  it('keeps pending users outside the operational shell', () => {
    expect(destinationForProfile('pending', true)).toBe('/pending');
  });

  it('keeps advertiser and driver profiles in a controlled unavailable page', () => {
    expect(destinationForProfile('advertiser', true)).toBe(
      '/acesso-indisponivel',
    );
    expect(destinationForProfile('driver', true)).toBe('/acesso-indisponivel');
  });

  it('allows active staff and blocks every inactive profile', () => {
    expect(destinationForProfile('operations', true)).toBe('/');
    expect(destinationForProfile('super_admin', true)).toBe('/');
    expect(destinationForProfile('super_admin', false)).toBe(
      '/acesso-indisponivel',
    );
  });
});

describe('role capabilities', () => {
  it('limits user management to administrators', () => {
    expect(canManageUsers('super_admin')).toBe(true);
    expect(canManageUsers('admin')).toBe(true);
    expect(canManageUsers('commercial')).toBe(false);
  });

  it('allows commercial writes but not operations writes', () => {
    expect(canWriteCommercialData('commercial')).toBe(true);
    expect(canWriteCommercialData('operations')).toBe(false);
  });
});
