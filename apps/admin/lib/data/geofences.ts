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

export async function listGeofencesForEstablishment(establishmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaign_geofence_admin_view')
    .select('*')
    .eq('establishment_id', establishmentId)
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

// MAX-020: a "geofence" is now a place (public.geofences) owned by an
// establishment, independent of which campaign(s) link to it — the
// functions above this line all read campaign_geofence_admin_view (a
// campaign<->place *link*, still exactly one row per link); everything
// below reads geofence_admin_view (the place itself).

export async function listGeofencePlacesForEstablishment(
  establishmentId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('geofence_admin_view')
    .select('*')
    .eq('establishment_id', establishmentId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function getGeofencePlace(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('geofence_admin_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Unfiltered, like listEstablishments() — the campaign<->geofence link
 * form shows every geofence and lets the form cross-reference client-side
 * against the selected campaign's advertiser, same pattern already used
 * for campaigns/establishments in that same form. */
export async function listAllGeofencePlaces() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('geofence_admin_view')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return data;
}
