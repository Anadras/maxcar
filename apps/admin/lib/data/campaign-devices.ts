import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { listDevices } from './devices';

/** Every active, non-archived device plus whether this campaign is
 * explicitly restricted to it. `unrestricted` mirrors what the manifest/
 * GEO rules RPCs actually do server-side: an empty `campaign_devices` set
 * means every device already receives the campaign, so the panel must
 * show that truthfully instead of implying nothing is assigned yet. */
export async function listCampaignDeviceAssignments(campaignId: string) {
  const supabase = await createClient();
  const [devices, { data: assignments, error }] = await Promise.all([
    listDevices('', '', '', 'active'),
    supabase
      .from('campaign_devices')
      .select('device_id')
      .eq('campaign_id', campaignId),
  ]);
  if (error) throw error;
  const assignedIds = new Set((assignments ?? []).map((row) => row.device_id));
  return {
    unrestricted: assignedIds.size === 0,
    devices: devices.map((device) => ({
      id: device.id,
      deviceCode: device.device_code,
      connectionStatus: device.connection_status,
      vehicleCode: device.vehicle_code,
      driverName: device.driver_name,
      assigned: assignedIds.has(device.id),
    })),
  };
}

/** Bloco 10: per-device delivery status for a single campaign, in plain
 * language, using only telemetry the tablet already reports — never a
 * fabricated "delivered" flag we can't actually verify server-side. Scoped
 * to the same eligible-device set the sync RPCs actually use (Bloco C):
 * every active device when unrestricted, only the allowlist otherwise. */
export async function listCampaignDeliveryStatus(
  campaignId: string,
  campaign: { updatedAt: string | null; campaignType: 'regular' | 'geo' },
) {
  const supabase = await createClient();
  const [devices, { data: assignments, error }] = await Promise.all([
    listDevices('', '', '', 'active'),
    supabase
      .from('campaign_devices')
      .select('device_id')
      .eq('campaign_id', campaignId),
  ]);
  if (error) throw error;
  const assignedIds = new Set((assignments ?? []).map((row) => row.device_id));
  const eligible =
    assignedIds.size === 0
      ? devices
      : devices.filter((device) => assignedIds.has(device.id));
  const campaignUpdatedAtMs = campaign.updatedAt
    ? new Date(campaign.updatedAt).getTime()
    : 0;

  return eligible.map((device) => {
    let statusLabel: string;
    if (device.connection_status === 'offline') {
      statusLabel = 'Offline — vai sincronizar assim que reconectar';
    } else if (
      campaign.campaignType === 'geo' &&
      device.last_geo_campaign_id === campaignId
    ) {
      statusLabel = 'Exibiu por proximidade recentemente';
    } else if (device.current_campaign_id === campaignId) {
      statusLabel = 'Reproduzindo agora';
    } else if (
      device.manifest_synced_at &&
      new Date(device.manifest_synced_at).getTime() >= campaignUpdatedAtMs
    ) {
      statusLabel =
        campaign.campaignType === 'geo'
          ? 'Sincronizado, aguardando o veículo entrar no raio'
          : 'Sincronizado, aguardando a vez na programação';
    } else {
      statusLabel = 'Sincronização pendente';
    }
    return {
      id: device.id,
      deviceCode: device.device_code,
      vehicleCode: device.vehicle_code,
      connectionStatus: device.connection_status,
      lastSyncAt: device.manifest_synced_at,
      statusLabel,
    };
  });
}
