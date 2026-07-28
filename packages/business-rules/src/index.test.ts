import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@maxcar/shared';
import {
  campaignReadinessIssues,
  enqueueGeoAfterCurrent,
  isCampaignScheduleValid,
  isCampaignStructurallyReady,
  resumeRegularSchedule,
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
