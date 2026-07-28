import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@maxcar/shared';
import { enqueueGeoAfterCurrent, resumeRegularSchedule } from './index';

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
