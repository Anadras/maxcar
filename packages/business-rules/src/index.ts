import type { QueueItem } from '@maxcar/shared';

export function enqueueGeoAfterCurrent(
  queue: readonly QueueItem[],
  geoCampaign: QueueItem,
): QueueItem[] {
  if (geoCampaign.kind !== 'geo') {
    throw new Error('Only GEO campaigns can enter the priority queue.');
  }

  if (queue.some((item) => item.id === geoCampaign.id)) {
    return [...queue];
  }

  if (queue.length === 0) {
    return [geoCampaign];
  }

  return [queue[0], geoCampaign, ...queue.slice(1)];
}

export function resumeRegularSchedule(
  queue: readonly QueueItem[],
): QueueItem[] {
  return queue.filter((item) => item.kind === 'regular');
}
