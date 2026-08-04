'use server';

import { getAuthContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';

export interface GeoTestState {
  error?: string;
  result?: {
    campaignActive: boolean;
    withinScheduleWindow: boolean;
    structurallyReady: boolean;
    deviceAllowed: boolean;
    deviceHasKnownLocation: boolean;
    geofences: Array<{
      establishmentName: string;
      radiusMeters: number;
      distanceMeters: number | null;
      insideRadius: boolean | null;
    }>;
  };
}

/**
 * MAX-011 Bloco D: "Testar campanha GEO neste dispositivo" — runs the exact
 * same eligibility check the tablet's own get_device_geo_rules call uses
 * (test_geo_campaign_delivery mirrors that predicate), keyed by device_id
 * so the panel never needs the device's real credential. Restricted to
 * super_admin in non-production, same gate as the existing heartbeat
 * simulator — this reads real establishment/heartbeat data but never
 * writes anything, and the caller must always label the result as
 * simulated.
 */
export async function testGeoCampaignDelivery(
  campaignId: string,
  _state: GeoTestState,
  formData: FormData,
): Promise<GeoTestState> {
  const auth = await getAuthContext();
  if (
    process.env.NODE_ENV === 'production' ||
    auth?.profile.role !== 'super_admin'
  ) {
    return {
      error:
        'Teste disponível apenas para superadministradores em desenvolvimento.',
    };
  }
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!deviceId) {
    return { error: 'Escolha um tablet para testar.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('test_geo_campaign_delivery', {
    p_device_id: deviceId,
    p_campaign_id: campaignId,
  });
  if (error || !data) {
    console.error('GEO campaign test failed', {
      code: error?.code,
      message: error?.message,
    });
    return { error: 'Não foi possível simular este teste.' };
  }

  const payload = data as {
    campaignActive: boolean;
    withinScheduleWindow: boolean;
    structurallyReady: boolean;
    deviceAllowed: boolean;
    deviceHasKnownLocation: boolean;
    geofences: Array<{
      establishmentName: string;
      radiusMeters: number;
      distanceMeters: number | null;
      insideRadius: boolean | null;
    }>;
  };
  return {
    result: {
      campaignActive: payload.campaignActive,
      withinScheduleWindow: payload.withinScheduleWindow,
      structurallyReady: payload.structurallyReady,
      deviceAllowed: payload.deviceAllowed,
      deviceHasKnownLocation: payload.deviceHasKnownLocation,
      geofences: payload.geofences,
    },
  };
}
