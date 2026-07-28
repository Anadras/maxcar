export type CampaignType = 'GRADE' | 'GEO';
export type OperationalStatus = 'Online' | 'Offline' | 'Atenção' | 'Manutenção';
export type UUID = string;
export type ISODateTime = string;

export type AppRole =
  | 'pending'
  | 'super_admin'
  | 'admin'
  | 'commercial'
  | 'operations'
  | 'advertiser'
  | 'driver';
export type DatabaseCampaignType = 'regular' | 'geo';
export type CampaignStatus =
  'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
export type DeviceStatus =
  'provisioning' | 'online' | 'offline' | 'maintenance' | 'retired';
export type VehicleStatus =
  'active' | 'offline' | 'maintenance' | 'unassigned' | 'retired';
export type DriverStatus = 'pending' | 'active' | 'inactive' | 'suspended';
export type CreativeType = 'image' | 'video';
export type ImpressionSource = 'regular' | 'geo';
export type ImpressionStatus =
  'started' | 'completed' | 'interrupted' | 'failed';

export interface ProfileRecord {
  id: UUID;
  fullName: string | null;
  role: AppRole;
  advertiserId: UUID | null;
  driverId: UUID | null;
  active: boolean;
}

export interface AdvertiserRecord {
  id: UUID;
  legalName: string;
  tradeName: string;
  status: 'active' | 'inactive' | 'suspended';
}

export interface EstablishmentRecord {
  id: UUID;
  advertiserId: UUID;
  name: string;
  city: string;
  state: string;
  active: boolean;
}

export interface DeviceRecord {
  id: UUID;
  vehicleId: UUID | null;
  deviceCode: string;
  status: DeviceStatus;
  appVersion: string | null;
  lastSeenAt: ISODateTime | null;
  lastSyncAt: ISODateTime | null;
}

export interface ImpressionRecord {
  id: UUID;
  deviceId: UUID;
  vehicleId: UUID | null;
  campaignId: UUID;
  creativeId: UUID | null;
  source: ImpressionSource;
  status: ImpressionStatus;
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
  clientEventId: UUID;
  offlineGenerated: boolean;
}

export interface QueueItem {
  id: string;
  title: string;
  kind: 'regular' | 'geo';
  durationSeconds: number;
}

export interface Campaign {
  id: string;
  name: string;
  client: string;
  type: CampaignType;
  status: 'Ativa' | 'Agendada' | 'Pausada';
  period: string;
  plays: number;
}
