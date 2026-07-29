import { describe, expect, it } from 'vitest';
import { advertiserSchema } from './advertisers';
import { campaignSchema } from './campaigns';
import { inspectCreativeFile } from './creatives';
import { establishmentSchema } from './establishments';
import { geofenceSchema } from './geofences';
import { deviceSchema } from './devices';
import { driverSchema } from './drivers';
import { normalizeLicensePlate, vehicleSchema } from './vehicles';

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

const validCampaign = {
  advertiserId: '13000000-0000-4000-8000-000000000001',
  name: 'Campanha Centro',
  campaignType: 'geo',
  status: 'draft',
  startsAt: '2026-07-28T08:00',
  endsAt: '2026-08-28T22:00',
  utcOffset: '-04:00',
  dailyStartTime: '08:00',
  dailyEndTime: '22:00',
  priority: 70,
  cooldownSeconds: 900,
  maxDailyImpressions: 100,
  activeDays: [1, 2, 3, 4, 5],
};

describe('campaign validation', () => {
  it('accepts an explicit operational offset and the database weekday format', () => {
    expect(campaignSchema.safeParse(validCampaign).success).toBe(true);
  });

  it('rejects inverted periods and new windows crossing midnight', () => {
    expect(
      campaignSchema.safeParse({
        ...validCampaign,
        endsAt: '2026-07-20T22:00',
      }).success,
    ).toBe(false);
    expect(
      campaignSchema.safeParse({
        ...validCampaign,
        dailyStartTime: '22:00',
        dailyEndTime: '05:00',
      }).success,
    ).toBe(false);
  });
});

describe('creative validation', () => {
  it('checks MIME, extension and binary signature together', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(
      inspectCreativeFile(
        { name: 'creative.png', type: 'image/png', size: png.length },
        png,
      ),
    ).toMatchObject({ success: true, creativeType: 'image' });
    expect(
      inspectCreativeFile(
        { name: 'creative.jpg', type: 'image/png', size: png.length },
        png,
      ).success,
    ).toBe(false);
  });
});

describe('geofence validation', () => {
  it('accepts a practical radius and rejects zero', () => {
    const base = {
      campaignId: '33000000-0000-4000-8000-000000000001',
      establishmentId: '23000000-0000-4000-8000-000000000001',
      radiusMeters: 1000,
      priorityOverride: null,
      cooldownOverrideSeconds: null,
      active: true,
    };
    expect(geofenceSchema.safeParse(base).success).toBe(true);
    expect(geofenceSchema.safeParse({ ...base, radiusMeters: 0 }).success).toBe(
      false,
    );
  });
});

describe('fleet validation', () => {
  it('accepts a complete driver and rejects malformed e-mail', () => {
    expect(
      driverSchema.safeParse({
        fullName: 'Maria Operadora',
        documentNumber: '',
        phone: '',
        email: 'maria@example.test',
        status: 'active',
      }).success,
    ).toBe(true);
    expect(
      driverSchema.safeParse({
        fullName: 'Maria Operadora',
        email: 'inválido',
        status: 'active',
      }).success,
    ).toBe(false);
  });

  it('normalizes Mercosul and legacy Brazilian plates', () => {
    expect(normalizeLicensePlate('abc-1d23')).toBe('ABC1D23');
    expect(
      vehicleSchema.parse({
        internalCode: 'car-010',
        licensePlate: 'abc-1234',
        make: '',
        model: '',
        year: '',
        driverId: '',
        status: 'active',
      }),
    ).toMatchObject({ internalCode: 'CAR-010', licensePlate: 'ABC1234' });
  });

  it('requires an operational device code', () => {
    expect(
      deviceSchema.safeParse({
        deviceCode: '',
        vehicleId: '',
        status: 'provisioning',
        appVersion: '',
      }).success,
    ).toBe(false);
  });
});
