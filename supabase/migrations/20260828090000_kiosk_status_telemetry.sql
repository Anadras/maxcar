-- MAX-019: operational observability ahead of the soak test. Not a
-- behavior change — Player/GEO/OTA/rollback/Device Owner/PIN/maintenance/
-- Lock Task rules are all untouched; this only widens what the tablet
-- reports about state that already exists.
--
-- Kiosk audit finding: KioskLevelDetector.currentLevel() returned
-- DEVICE_OWNER whenever isDeviceOwnerApp() was true, without ever
-- checking ActivityManager.lockTaskModeState in that branch — confirmed
-- against TESTE01's real heartbeat history that kiosk_level was
-- 'device_owner' in 100% of 926 heartbeats today, including several
-- multi-hour windows where mLockTaskModeState was demonstrably NONE (no
-- ready content in the grade). The panel had no way to distinguish
-- "kiosk healthy, Lock Task actually engaged" from "kiosk healthy
-- privilege-wise, but Lock Task currently disengaged for some reason."
--
-- Fix (Android-side, this migration only carries the schema): the
-- Device-Owner branch now resolves to one of four states instead of one,
-- checking the real reason before falling back to the raw OS lock-task
-- state. Old values are kept valid — already-stored rows and any
-- not-yet-updated build must keep working unchanged.
alter table public.device_heartbeats
  drop constraint device_heartbeats_kiosk_level_check;
alter table public.device_heartbeats
  add constraint device_heartbeats_kiosk_level_check check (
    kiosk_level is null or kiosk_level in (
      'none', 'immersive', 'lock_task', 'device_owner',
      'device_owner_locked', 'device_owner_unlocked',
      'maintenance_mode', 'no_content_mode'
    )
  );

comment on column public.device_heartbeats.kiosk_level is
  'What the tablet actually achieved, never what it merely attempted. none/immersive/lock_task/device_owner are the pre-MAX-019 vocabulary, kept valid for historical rows and never emitted by a MAX-019+ build. device_owner_locked/device_owner_unlocked/maintenance_mode/no_content_mode are mutually exclusive: for a Device Owner tablet, maintenance_mode and no_content_mode are checked before the raw lockTaskModeState, so a NONE state always carries an explanation.';

-- Only meaningful (and only ever populated) alongside kiosk_level =
-- device_owner_unlocked — the one bucket that isn't already
-- self-explanatory. Never populated for the other levels; nothing here to
-- explain when the level itself already says why.
alter table public.device_heartbeats
  add column kiosk_reason text;
alter table public.device_heartbeats
  add constraint device_heartbeats_kiosk_reason_check check (
    kiosk_reason is null or kiosk_reason in (
      'kiosk_disabled_remotely', 'lock_task_not_engaged'
    )
  );

comment on column public.device_heartbeats.kiosk_reason is
  'Further detail for kiosk_level = device_owner_unlocked: kiosk_disabled_remotely (app_remote_config.kiosk_enabled is false, expected) vs lock_task_not_engaged (everything else says it should be locked and it is not — the one value worth alerting on).';

-- "Último frame confirmado" / time-without-playback: device_heartbeats is
-- an append-only log, so deriving this from history alone means scanning
-- back through however many rows it takes — unbounded, and silently wrong
-- once the scan window runs out. Tracked instead as one persisted instant
-- on devices, the same pattern last_seen_at/last_sync_at already
-- established, updated by record_device_heartbeat itself whenever
-- player_state = 'playing_confirmed' is reported.
alter table public.devices
  add column last_confirmed_frame_at timestamptz;

comment on column public.devices.last_confirmed_frame_at is
  'Server time of the most recent heartbeat reporting player_state = playing_confirmed. now() - this is "tempo sem reprodução" without needing to scan heartbeat history.';

drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text, integer
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
  p_quarantined_media_count integer default null,
  p_kiosk_reason text default null
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
    quarantined_media_count, kiosk_reason
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, coalesce(p_gps_available, false),
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error,
    v_location, p_location_accuracy_meters, p_location_permission_granted,
    p_last_location_error, p_last_geofence_entry_at, p_last_geo_campaign_id,
    p_operational_status, p_pending_event_count, p_clock_skew_seconds, p_kiosk_level,
    p_quarantined_media_count, p_kiosk_reason
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
  set last_seen_at = v_recorded_at,
      last_sync_at = v_recorded_at,
      last_confirmed_frame_at = case
        when p_player_state = 'playing_confirmed' then v_recorded_at
        else last_confirmed_frame_at
      end
  where id = v_device_id;

  return query select v_device_id as out_device_id, d.device_code, v_recorded_at from public.devices d where d.id = v_device_id;
end;
$$;

comment on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text, integer, text
) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock. p_kiosk_level/p_kiosk_reason are what the tablet actually achieved, never what it merely attempted. devices.last_confirmed_frame_at only ever advances, never resets, on a playing_confirmed report.';

revoke all on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text, integer, text
) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text, integer, text
) to service_role;
