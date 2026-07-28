import { describe, expect, it } from 'vitest';
import { advertiserSchema } from './advertisers';
import { establishmentSchema } from './establishments';

describe('advertiser validation', () => {
  it('rejects malformed contacts', () => {
    const result = advertiserSchema.safeParse({
      legalName: 'Empresa Ltda',
      tradeName: 'Empresa',
      contactEmail: 'invalid',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });
});

describe('establishment validation', () => {
  const valid = {
    advertiserId: '13000000-0000-4000-8000-000000000001',
    name: 'Unidade Centro',
    addressLine: 'Rua 14 de Julho',
    city: 'Campo Grande',
    state: 'ms',
    latitude: -20.4697,
    longitude: -54.6201,
    active: true,
  };

  it('normalizes the state and accepts valid WGS84 coordinates', () => {
    const result = establishmentSchema.parse(valid);
    expect(result.state).toBe('MS');
  });

  it('rejects coordinates outside terrestrial bounds', () => {
    expect(
      establishmentSchema.safeParse({ ...valid, latitude: 91 }).success,
    ).toBe(false);
    expect(
      establishmentSchema.safeParse({ ...valid, longitude: -181 }).success,
    ).toBe(false);
  });
});
