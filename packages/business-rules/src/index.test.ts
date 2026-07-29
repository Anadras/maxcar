import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@maxcar/shared';
import {
  campaignReadinessIssues,
  enqueueGeoAfterCurrent,
  getDeviceConnectionStatus,
  getHeartbeatHealth,
  isCampaignScheduleValid,
  isCampaignStructurallyReady,
  isDeviceOnline,
  resumeRegularSchedule,
  vehicleCanReceiveDevice,
} from './index';

const regularQueue: QueueItem[] = [
  {
    id: 'current',
    title: 'Institucional Midiamax',
    kind: 'regular',
    durationSeconds: 15,
  },
  {
    id: 'editorial',
    title: 'Conteúdo editorial',
    kind: 'regular',
    durationSeconds: 20,
  },
];

const geo: QueueItem = {
  id: 'geo-pizza',
  title: 'Oferta Pizzaria Central',
  kind: 'geo',
  durationSeconds: 15,
};

describe('GEO priority queue', () => {
  it('keeps the current media first and inserts GEO immediately after it', () => {
    expect(
      enqueueGeoAfterCurrent(regularQueue, geo).map((item) => item.id),
    ).toEqual(['current', 'geo-pizza', 'editorial']);
  });

  it('does not duplicate the same GEO campaign', () => {
    const once = enqueueGeoAfterCurrent(regularQueue, geo);
    expect(enqueueGeoAfterCurrent(once, geo)).toEqual(once);
  });

  it('returns to the regular schedule after GEO playback', () => {
    expect(
      resumeRegularSchedule(enqueueGeoAfterCurrent(regularQueue, geo)),
    ).toEqual(regularQueue);
  });
});

describe('fleet health', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  it('derives online, attention and offline from the latest heartbeat', () => {
    expect(
      getDeviceConnectionStatus('2026-07-28T11:56:00Z', 'online', now),
    ).toBe('online');
    expect(
      getDeviceConnectionStatus('2026-07-28T11:50:00Z', 'online', now),
    ).toBe('attention');
    expect(
      getDeviceConnectionStatus('2026-07-28T11:40:00Z', 'online', now),
    ).toBe('offline');
    expect(getDeviceConnectionStatus(null, 'online', now)).toBe('offline');
  });

  it('keeps retired and maintenance devices outside connection alerts', () => {
    expect(
      getDeviceConnectionStatus('2026-07-28T12:00:00Z', 'retired', now),
    ).toBe('inactive');
    expect(isDeviceOnline('2026-07-28T12:00:00Z', 'maintenance', now)).toBe(
      false,
    );
  });

  it('reports heartbeat subsystems without hiding missing telemetry', () => {
    expect(
      getHeartbeatHealth({
        recordedAt: '2026-07-28T11:58:00Z',
        deviceStatus: 'online',
        batteryLevel: 18,
        networkConnected: false,
        gpsAvailable: true,
        now,
      }),
    ).toEqual({
      connection: 'online',
      battery: 'low',
      network: 'disconnected',
      gps: 'available',
    });
  });

  it('allows only an empty vehicle or the same device link', () => {
    expect(vehicleCanReceiveDevice(null, 'device-1')).toBe(true);
    expect(vehicleCanReceiveDevice('device-1', 'device-1')).toBe(true);
    expect(vehicleCanReceiveDevice('device-1', 'device-2')).toBe(false);
  });
});

const readyRegular = {
  campaignType: 'regular' as const,
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-08-01T00:00:00.000Z',
  dailyStartTime: '08:00',
  dailyEndTime: '22:00',
  activeDays: [1, 2, 3, 4, 5],
  activeCreativeCount: 1,
  activeGeofenceCount: 0,
};

describe('campaign readiness', () => {
  it('accepts a complete REGULAR campaign without a geofence', () => {
    expect(isCampaignStructurallyReady(readyRegular)).toBe(true);
  });

  it('requires an active creative for every campaign', () => {
    expect(
      campaignReadinessIssues({
        ...readyRegular,
        activeCreativeCount: 0,
      }),
    ).toContain('missing-creative');
  });

  it('requires a geofence only for GEO campaigns', () => {
    expect(
      campaignReadinessIssues({
        ...readyRegular,
        campaignType: 'geo',
      }),
    ).toContain('missing-geofence');
    expect(campaignReadinessIssues(readyRegular)).not.toContain(
      'missing-geofence',
    );
  });

  it('rejects periods ending before they begin', () => {
    expect(
      isCampaignScheduleValid({
        ...readyRegular,
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('blocks new daily windows that cross midnight', () => {
    expect(
      isCampaignScheduleValid({
        ...readyRegular,
        dailyStartTime: '22:00',
        dailyEndTime: '05:00',
      }),
    ).toBe(false);
  });

  it('rejects empty, duplicated or out-of-range weekdays', () => {
    expect(isCampaignScheduleValid({ ...readyRegular, activeDays: [] })).toBe(
      false,
    );
    expect(
      isCampaignScheduleValid({ ...readyRegular, activeDays: [1, 1] }),
    ).toBe(false);
    expect(isCampaignScheduleValid({ ...readyRegular, activeDays: [7] })).toBe(
      false,
    );
  });
});
