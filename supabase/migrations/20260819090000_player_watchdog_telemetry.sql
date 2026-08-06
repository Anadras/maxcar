-- MAX-012: the Android player now runs its own watchdog (first-frame
-- timeout, playback-stall check, duration ceiling) instead of trusting
-- ExoPlayer to eventually raise an error — see
-- docs/architecture/ANDROID_PLAYER_WATCHDOG.md for the TESTE01/regular02
-- incident that motivated it. A creative that fails twice in a row is
-- quarantined locally on the device; this migration adds the one new
-- heartbeat field the panel needs to see that happening
-- (quarantined_media_count) — everything else about player state already
-- flows through the existing free-text player_state/operational_status
-- columns, now populated with a richer vocabulary from the Android side
-- (preparing/buffering/playing_confirmed/stalled/recovering/media_error/
-- no_ready_media) without any schema change of their own.

alter table public.device_heartbeats
  add column quarantined_media_count integer;

alter table public.device_heartbeats
  add constraint device_heartbeats_quarantined_media_count_check
  check (quarantined_media_count is null or quarantined_media_count >= 0);

-- The watchdog's own states (recovering/media_error — see
-- PlaybackState.kt) now reach operational_status via SyncCoordinator's
-- operationalStatusFor mapping; the fixed enum-style check from
-- 20260806090000 predates them.
alter table public.device_heartbeats
  drop constraint device_heartbeats_operational_status_check;
alter table public.device_heartbeats
  add constraint device_heartbeats_operational_status_check check (
    operational_status is null or operational_status in (
      'ready', 'playing', 'offline_playing', 'syncing', 'downloading',
      'no_content', 'error', 'maintenance', 'recovering', 'media_error'
    )
  );

-- Postgres treats a changed parameter list as a distinct overload, not a
-- replacement — the exact-signature drop below is what actually retires
-- the 25-argument version instead of leaving both reachable and
-- ambiguous for any positional call that doesn't disambiguate (the same
-- pattern 20260806090000 already established for this same function).
drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text
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
  p_last_geo_campaign_id uuid default null,
  p_operational_status text default null,
  p_pending_event_count integer default null,
  p_clock_skew_seconds integer default null,
  p_kiosk_level text default null,
  p_quarantined_media_count integer default null
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
    last_location_error, last_geofence_entry_at, last_geo_campaign_id,
    operational_status, pending_event_count, clock_skew_seconds, kiosk_level,
    quarantined_media_count
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, coalesce(p_gps_available, false),
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error,
    v_location, p_location_accuracy_meters, p_location_permission_granted,
    p_last_location_error, p_last_geofence_entry_at, p_last_geo_campaign_id,
    p_operational_status, p_pending_event_count, p_clock_skew_seconds, p_kiosk_level,
    p_quarantined_media_count
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
