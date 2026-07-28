import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listGeofences() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofence_admin_view')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getGeofence(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofence_admin_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCampaignGeofences(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofence_admin_view')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listEstablishmentsForAdvertiser(advertiserId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('establishment_admin_view')
    .select('id, name, city, state, advertiser_id, latitude, longitude')
    .eq('advertiser_id', advertiserId)
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return data;
}
