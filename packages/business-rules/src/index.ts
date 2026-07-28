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

export interface CampaignReadinessInput {
  campaignType: 'regular' | 'geo';
  startsAt: string | null;
  endsAt: string | null;
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  activeDays: readonly number[];
  activeCreativeCount: number;
  activeGeofenceCount: number;
}

export type CampaignReadinessIssue =
  | 'missing-period'
  | 'invalid-period'
  | 'invalid-daily-window'
  | 'invalid-active-days'
  | 'missing-creative'
  | 'missing-geofence';

export function campaignReadinessIssues(
  campaign: CampaignReadinessInput,
): CampaignReadinessIssue[] {
  const issues: CampaignReadinessIssue[] = [];
  if (!campaign.startsAt || !campaign.endsAt) {
    issues.push('missing-period');
  } else if (
    Number.isNaN(Date.parse(campaign.startsAt)) ||
    Number.isNaN(Date.parse(campaign.endsAt)) ||
    Date.parse(campaign.endsAt) < Date.parse(campaign.startsAt)
  ) {
    issues.push('invalid-period');
  }

  if (
    campaign.dailyStartTime &&
    campaign.dailyEndTime &&
    campaign.dailyEndTime < campaign.dailyStartTime
  ) {
    issues.push('invalid-daily-window');
  }

  const uniqueDays = new Set(campaign.activeDays);
  if (
    uniqueDays.size !== campaign.activeDays.length ||
    uniqueDays.size === 0 ||
    [...uniqueDays].some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    issues.push('invalid-active-days');
  }
  if (campaign.activeCreativeCount < 1) issues.push('missing-creative');
  if (campaign.campaignType === 'geo' && campaign.activeGeofenceCount < 1) {
    issues.push('missing-geofence');
  }
  return issues;
}

export function isCampaignScheduleValid(
  campaign: Pick<
    CampaignReadinessInput,
    'startsAt' | 'endsAt' | 'dailyStartTime' | 'dailyEndTime' | 'activeDays'
  >,
) {
  return !campaignReadinessIssues({
    campaignType: 'regular',
    activeCreativeCount: 1,
    activeGeofenceCount: 0,
    ...campaign,
  }).some((issue) =>
    [
      'missing-period',
      'invalid-period',
      'invalid-daily-window',
      'invalid-active-days',
    ].includes(issue),
  );
}

export function isCampaignStructurallyReady(campaign: CampaignReadinessInput) {
  return campaignReadinessIssues(campaign).length === 0;
}
