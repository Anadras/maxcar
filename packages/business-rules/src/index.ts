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

export type DeviceConnectionStatus =
  'online' | 'attention' | 'offline' | 'inactive';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const ATTENTION_WINDOW_MS = 15 * 60 * 1000;

export function getDeviceConnectionStatus(
  lastHeartbeatAt: string | null,
  deviceStatus: string,
  now: Date = new Date(),
): DeviceConnectionStatus {
  if (deviceStatus === 'retired' || deviceStatus === 'maintenance') {
    return 'inactive';
  }
  if (!lastHeartbeatAt) return 'offline';
  const age = now.getTime() - Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(age) || age > ATTENTION_WINDOW_MS) return 'offline';
  if (age > ONLINE_WINDOW_MS) return 'attention';
  return 'online';
}

export function isDeviceOnline(
  lastHeartbeatAt: string | null,
  deviceStatus: string,
  now: Date = new Date(),
) {
  return (
    getDeviceConnectionStatus(lastHeartbeatAt, deviceStatus, now) === 'online'
  );
}

export interface HeartbeatHealth {
  connection: DeviceConnectionStatus;
  battery: 'healthy' | 'low' | 'unknown';
  network: 'connected' | 'disconnected' | 'unknown';
  gps: 'available' | 'unavailable' | 'unknown';
}

export function getHeartbeatHealth(input: {
  recordedAt: string | null;
  deviceStatus: string;
  batteryLevel: number | null;
  networkConnected: boolean | null;
  gpsAvailable: boolean | null;
  now?: Date;
}): HeartbeatHealth {
  return {
    connection: getDeviceConnectionStatus(
      input.recordedAt,
      input.deviceStatus,
      input.now,
    ),
    battery:
      input.batteryLevel === null
        ? 'unknown'
        : input.batteryLevel < 20
          ? 'low'
          : 'healthy',
    network:
      input.networkConnected === null
        ? 'unknown'
        : input.networkConnected
          ? 'connected'
          : 'disconnected',
    gps:
      input.gpsAvailable === null
        ? 'unknown'
        : input.gpsAvailable
          ? 'available'
          : 'unavailable',
  };
}

export function vehicleCanReceiveDevice(
  currentDeviceId: string | null,
  candidateDeviceId?: string,
) {
  return currentDeviceId === null || currentDeviceId === candidateDeviceId;
}
