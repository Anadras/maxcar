-- MAX-010: maintenance PIN, delivered to the device the same way remote
-- config already is, and the kiosk layer the tablet reports actually
-- achieving (never just the layer it *attempted*).

alter table public.devices
  add column maintenance_pin_hash text,
  add column maintenance_pin_salt text;

comment on column public.devices.maintenance_pin_hash is
  'sha256(pin || salt), never the plaintext PIN. A 4-8 digit PIN is inherently brute-forceable given physical device access; the real defense is the Android-side attempt lockout, not hash strength — same tradeoff class as the device credential token itself.';

-- devices_staff_write (MAX-002 RLS) is a row-level policy: any
-- super_admin/admin/operations can already UPDATE a device row for
-- ordinary edits (device_code, status, vehicle_id, app_version). RLS
-- alone can't restrict *which columns* of that same row a role may touch,
-- and a column-level REVOKE has no effect on top of the broad table-level
-- `grant ... update on all tables in schema public` (MAX-002) — a
-- table-level grant already authorizes every column regardless of a later
-- column-level revoke. The only way to actually narrow this is to revoke
-- the table-level UPDATE entirely and re-grant it only for the columns
-- `authenticated` needs to write directly: `devicePayload` in
-- `apps/admin/app/(protected)/dispositivos/actions.ts` (device_code,
-- vehicle_id, status, app_version), plus last_seen_at, the one column
-- `simulate_device_heartbeat` (dev-only, deliberately `security invoker`
-- so it enforces super_admin the same way RLS does, not a
-- SECURITY DEFINER bypass) still writes directly. Every other device
-- mutation in this codebase already goes through a SECURITY DEFINER
-- function (archive_device, restore_device, record_device_heartbeat,
-- etc.), which writes as the function owner and is unaffected by this
-- revoke — that's what keeps maintenance_pin_hash/salt reachable only
-- through set_device_maintenance_pin.
revoke update on public.devices from authenticated;
grant update (device_code, vehicle_id, status, app_version, last_seen_at)
  on public.devices to authenticated;

-- Reuses the existing audit_events infrastructure (MAX admin marco):
-- setting/changing a PIN is exactly the kind of sensitive administrative
-- action that table already exists for.
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in (
    'archive', 'restore', 'deactivate', 'reactivate', 'unlink', 'delete',
    'set_maintenance_pin'
  )
);

create or replace function public.set_device_maintenance_pin(
  p_device_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
  v_hash text;
  v_device_code text;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can set a device maintenance PIN.';
  end if;
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception using errcode = '22023', message = 'PIN must be 4 to 8 digits.';
  end if;

  select device_code into v_device_code from public.devices where id = p_device_id;
  if v_device_code is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  v_salt := encode(extensions.gen_random_bytes(16), 'hex');
  v_hash := encode(extensions.digest(p_pin || v_salt, 'sha256'), 'hex');

  update public.devices
  set maintenance_pin_hash = v_hash, maintenance_pin_salt = v_salt
  where id = p_device_id;

  -- The PIN itself never enters before_snapshot or any other audit field —
  -- only that it changed, by whom, and when.
  perform private.record_audit_event(
    'set_maintenance_pin', 'device', p_device_id, v_device_code, null, null
  );
end;
$$;

revoke all on function public.set_device_maintenance_pin(uuid, text) from public, anon;
grant execute on function public.set_device_maintenance_pin(uuid, text) to authenticated;

-- create or replace can't add columns to a table function's return type;
-- drop first (MAX-007/008/009 already established this pattern for
-- record_device_heartbeat).
drop function if exists public.get_device_config(text);

create or replace function public.get_device_config(p_token text)
returns table (
  device_id uuid,
  device_code text,
  vehicle_id uuid,
  vehicle_code text,
  heartbeat_interval_seconds integer,
  sync_interval_seconds integer,
  kiosk_enabled boolean,
  logging_level text,
  config_version integer,
  maintenance_pin_hash text,
  maintenance_pin_salt text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
begin
  v_device_id := private.device_id_for_token(p_token);
  return query
  select
    d.id, d.device_code, d.vehicle_id, v.internal_code,
    c.heartbeat_interval_seconds, c.sync_interval_seconds, c.kiosk_enabled,
    c.logging_level, c.config_version,
    d.maintenance_pin_hash, d.maintenance_pin_salt
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  cross join public.app_remote_config c
  where d.id = v_device_id;
end;
$$;

revoke all on function public.get_device_config(text) from public, anon, authenticated;
grant execute on function public.get_device_config(text) to service_role;

comment on function public.get_device_config(text) is
  'maintenance_pin_hash/salt let the tablet validate its admin PIN fully offline (MAX-010) — the plaintext PIN itself never leaves this function''s caller (set_device_maintenance_pin).';

-- Kiosk layer the tablet actually achieved, not just attempted — never
-- pretend the device is fully protected if it's merely immersive/pinned.
alter table public.device_heartbeats
  add column kiosk_level text;

alter table public.device_heartbeats
  add constraint device_heartbeats_kiosk_level_check check (
    kiosk_level is null or kiosk_level in ('none', 'immersive', 'lock_task', 'device_owner')
  );

drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer
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
  p_kiosk_level text default null
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
    operational_status, pending_event_count, clock_skew_seconds, kiosk_level
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, coalesce(p_gps_available, false),
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error,
    v_location, p_location_accuracy_meters, p_location_permission_granted,
    p_last_location_error, p_last_geofence_entry_at, p_last_geo_campaign_id,
    p_operational_status, p_pending_event_count, p_clock_skew_seconds, p_kiosk_level
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
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text
) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock. p_kiosk_level is what the tablet actually achieved (none/immersive/lock_task/device_owner), never what it merely attempted.';

revoke all on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer, text
) to service_role;
