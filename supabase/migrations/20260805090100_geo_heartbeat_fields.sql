-- MAX-008: GPS/GEO status on the heartbeat, so the panel can show
-- GPS active/inactive, last location, accuracy, last geofence entry, last
-- GEO campaign fired, last location error and permission granted/denied —
-- same additive pattern as MAX-007's player-state heartbeat fields:
-- every new parameter is optional, so an older app build's heartbeat call
-- keeps working unchanged.

alter table public.device_heartbeats
  add column location_accuracy_meters numeric(6, 2),
  add column location_permission_granted boolean,
  add column last_location_error text,
  add column last_geofence_entry_at timestamptz,
  add column last_geo_campaign_id uuid references public.campaigns (id) on delete set null;

alter table public.device_heartbeats
  add constraint device_heartbeats_location_accuracy_check
  check (location_accuracy_meters is null or location_accuracy_meters >= 0);

comment on column public.device_heartbeats.last_location_error is
  'Short, user-safe diagnostic string only (e.g. "permission_denied", "provider_unavailable") — never a stack trace.';

drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text
);

create or replace function public.record_device_heartbeat(
  p_token text,
  p_battery_level smallint default null,
  p_network_type text default 'offline',
  p_storage_free_bytes bigint default null,
  p_app_version text default null,
  p_device_time timestamptz default null,
  p_client_event_id uuid default null,
  p_player_state text default null,
  p_media_ready_count integer default null,
  p_manifest_version text default null,
  p_current_campaign_id uuid default null,
  p_current_creative_id uuid default null,
  p_last_error text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_gps_available boolean default false,
  p_location_accuracy_meters numeric default null,
  p_location_permission_granted boolean default null,
  p_last_location_error text default null,
  p_last_geofence_entry_at timestamptz default null,
  p_last_geo_campaign_id uuid default null
)
returns table (out_device_id uuid, device_code text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_recorded_at timestamptz;
  v_network_connected boolean := coalesce(p_network_type, 'offline') <> 'offline';
  v_location extensions.geography(Point, 4326);
begin
  v_device_id := private.device_id_for_token(p_token);

  if p_latitude is not null and p_longitude is not null then
    if p_latitude between -90 and 90 and p_longitude between -180 and 180 then
      v_location := extensions.st_setsrid(
        extensions.st_makepoint(p_longitude, p_latitude), 4326
      )::extensions.geography;
    end if;
  end if;

  insert into public.device_heartbeats (
    device_id, recorded_at, battery_level, network_connected, gps_available,
    storage_free_bytes, app_version, client_event_id,
    player_state, media_ready_count, manifest_version,
    current_campaign_id, current_creative_id, last_error,
    location, location_accuracy_meters, location_permission_granted,
    last_location_error, last_geofence_entry_at, last_geo_campaign_id
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, coalesce(p_gps_available, false),
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error,
    v_location, p_location_accuracy_meters, p_location_permission_granted,
    p_last_location_error, p_last_geofence_entry_at, p_last_geo_campaign_id
  )
  on conflict (device_id, client_event_id) where client_event_id is not null
  do nothing
  returning device_heartbeats.recorded_at into v_recorded_at;

  if v_recorded_at is null then
    select device_heartbeats.recorded_at into v_recorded_at
    from public.device_heartbeats
    where device_id = v_device_id and client_event_id = p_client_event_id;
  end if;

  update public.devices
  set last_seen_at = v_recorded_at, last_sync_at = v_recorded_at
  where id = v_device_id;

  return query select v_device_id as out_device_id, d.device_code, v_recorded_at from public.devices d where d.id = v_device_id;
end;
$$;

comment on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid
) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock.';

revoke all on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid
) to service_role;

-- Panel-facing view of a device's most recent heartbeat, including the new
-- GPS/GEO fields — used by the admin device detail page instead of a raw
-- query against device_heartbeats so the panel never needs to know the
-- "latest per device" logic itself.
create or replace view public.device_latest_heartbeat_view
with (security_invoker = true)
as
select distinct on (dh.device_id)
  dh.device_id,
  dh.recorded_at,
  dh.battery_level,
  dh.network_connected,
  dh.gps_available,
  dh.storage_free_bytes,
  dh.app_version,
  dh.player_state,
  dh.media_ready_count,
  dh.manifest_version,
  dh.current_campaign_id,
  dh.current_creative_id,
  dh.last_error,
  extensions.st_y(dh.location::extensions.geometry) as last_latitude,
  extensions.st_x(dh.location::extensions.geometry) as last_longitude,
  dh.location_accuracy_meters,
  dh.location_permission_granted,
  dh.last_location_error,
  dh.last_geofence_entry_at,
  dh.last_geo_campaign_id
from public.device_heartbeats dh
order by dh.device_id, dh.recorded_at desc;

revoke all on public.device_latest_heartbeat_view from public, anon;
grant select on public.device_latest_heartbeat_view to authenticated;

comment on view public.device_latest_heartbeat_view is
  'One row per device: its most recent heartbeat, with GPS/GEO status resolved to plain lat/lng for the panel.';
