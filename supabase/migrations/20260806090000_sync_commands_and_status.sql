-- MAX-009: remote commands and expanded operational status on the
-- heartbeat, so the panel can see and drive real device state instead of
-- only observing it.

create type public.device_command_type as enum (
  'sync_now',
  'restart_player',
  'clear_obsolete_media',
  'enter_maintenance',
  'exit_maintenance',
  'update_config'
);

create type public.device_command_status as enum (
  'pending',
  'delivered',
  'completed',
  'failed',
  'expired'
);

-- Deliberately small and closed: no arbitrary shell, no free-text payload a
-- device blindly executes. Each command is one of six fixed, safe
-- operations; a device that doesn't recognize a command_type simply can't
-- receive one, since the enum itself is the whole contract. The row is its
-- own audit trail (who issued it, when, current status, when delivered/
-- completed) — no separate write into audit_events, since a command isn't
-- a fleet-lifecycle action on a driver/vehicle/device record.
create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  command_type public.device_command_type not null,
  status public.device_command_status not null default 'pending',
  issued_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  delivered_at timestamptz,
  completed_at timestamptz,
  result text,
  constraint device_commands_result_check check (
    result is null or length(result) <= 500
  )
);

create index device_commands_device_pending_idx
  on public.device_commands (device_id, status, created_at)
  where status in ('pending', 'delivered');
create index device_commands_device_created_at_idx
  on public.device_commands (device_id, created_at desc);

alter table public.device_commands enable row level security;
revoke all on public.device_commands from public, anon, authenticated;

create policy device_commands_staff_select on public.device_commands
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'));
grant select on public.device_commands to authenticated;

-- Panel-facing: queues one command for a device. Restricted to the same
-- fleet-manager roles as the lifecycle actions (MAX admin marco), not
-- open to commercial/advertiser/driver roles.
create or replace function public.create_device_command(
  p_device_id uuid,
  p_command_type public.device_command_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_fleet_manager();

  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  insert into public.device_commands (device_id, command_type, issued_by)
  values (p_device_id, p_command_type, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_device_command(
  uuid, public.device_command_type
) from public, anon;
grant execute on function public.create_device_command(
  uuid, public.device_command_type
) to authenticated;

-- Device-facing: fetches whatever is pending (and not yet expired) for the
-- calling device, marking each returned row 'delivered' in the same call
-- so a retried sync cycle doesn't re-fetch (and re-execute) the same
-- command indefinitely — acknowledge_device_command below is still what
-- moves it to a final state.
create or replace function public.get_device_pending_commands(p_token text)
returns table (
  command_id uuid,
  command_type public.device_command_type,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  update public.device_commands
  set status = 'delivered', delivered_at = now()
  where device_id = v_device_id
    and status = 'pending'
    and expires_at > now();

  update public.device_commands
  set status = 'expired'
  where device_id = v_device_id
    and status = 'pending'
    and expires_at <= now();

  return query
  select id, device_commands.command_type, device_commands.created_at
  from public.device_commands
  where device_id = v_device_id
    and status = 'delivered'
  order by device_commands.created_at;
end;
$$;

revoke all on function public.get_device_pending_commands(text) from public, anon, authenticated;
grant execute on function public.get_device_pending_commands(text) to service_role;

create or replace function public.acknowledge_device_command(
  p_token text,
  p_command_id uuid,
  p_status public.device_command_status,
  p_result text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  if p_status not in ('completed', 'failed') then
    raise exception using errcode = '22023', message = 'status must be completed or failed.';
  end if;

  update public.device_commands
  set status = p_status, completed_at = now(), result = left(p_result, 500)
  where id = p_command_id and device_id = v_device_id;
end;
$$;

revoke all on function public.acknowledge_device_command(
  text, uuid, public.device_command_status, text
) from public, anon, authenticated;
grant execute on function public.acknowledge_device_command(
  text, uuid, public.device_command_status, text
) to service_role;

-- Expanded heartbeat status: what the tablet itself decided its
-- operational state is, how many events are still queued locally, and how
-- far its own clock diverges from the server's — never blindly trusted,
-- only ever informative for the panel.
alter table public.device_heartbeats
  add column operational_status text,
  add column pending_event_count integer,
  add column clock_skew_seconds integer;

alter table public.device_heartbeats
  add constraint device_heartbeats_operational_status_check check (
    operational_status is null or operational_status in (
      'ready', 'playing', 'offline_playing', 'syncing', 'downloading',
      'no_content', 'error', 'maintenance'
    )
  ),
  add constraint device_heartbeats_pending_event_count_check check (
    pending_event_count is null or pending_event_count >= 0
  );

drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid
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
  p_clock_skew_seconds integer default null
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
    operational_status, pending_event_count, clock_skew_seconds
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, coalesce(p_gps_available, false),
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error,
    v_location, p_location_accuracy_meters, p_location_permission_granted,
    p_last_location_error, p_last_geofence_entry_at, p_last_geo_campaign_id,
    p_operational_status, p_pending_event_count, p_clock_skew_seconds
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
  text, integer, integer
) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock. p_clock_skew_seconds is the tablet''s own comparison, informative only.';

revoke all on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text,
  double precision, double precision, boolean, numeric, boolean, text, timestamptz, uuid,
  text, integer, integer
) to service_role;

comment on table public.device_commands is
  'Small, closed set of safe remote operations (never arbitrary shell) a fleet manager can queue for a device; delivered and acknowledged through the same token-authenticated device API as everything else.';
