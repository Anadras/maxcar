import type { Database } from './database.types';

export type CampaignType = 'GRADE' | 'GEO';
export type OperationalStatus = 'Online' | 'Offline' | 'Atenção' | 'Manutenção';
export type UUID = string;
export type ISODateTime = string;

export type AppRole = Database['public']['Enums']['app_role'];
export type DatabaseCampaignType = Database['public']['Enums']['campaign_type'];
export type CampaignStatus = Database['public']['Enums']['campaign_status'];
export type DeviceStatus = Database['public']['Enums']['device_status'];
export type VehicleStatus = Database['public']['Enums']['vehicle_status'];
export type DriverStatus = Database['public']['Enums']['driver_status'];
export type CreativeType = Database['public']['Enums']['creative_type'];
export type ImpressionSource = Database['public']['Enums']['impression_source'];
export type ImpressionStatus = Database['public']['Enums']['impression_status'];
export type DeviceCommandType =
  Database['public']['Enums']['device_command_type'];
export type DeviceCommandStatus =
  Database['public']['Enums']['device_command_status'];

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
