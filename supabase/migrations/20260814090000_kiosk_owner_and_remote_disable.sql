-- MAX-011: Device Owner kiosk lockdown — three new remote command verbs
-- that operate the tablet's Lock Task state directly (enable/disable/
-- reenter), and a per-device maintenance-timeout duration alongside the
-- existing per-device maintenance PIN (MAX-010), following the exact same
-- SECURITY DEFINER + audit pattern set_device_maintenance_pin already
-- established.

-- New device_command_type values. Each is a single, no-payload verb the
-- Android executor maps 1:1 to a local state change (see
-- DeviceCommandExecutor.kt) — no new column/payload plumbing needed, the
-- existing create_device_command/get_device_pending_commands/
-- acknowledge_device_command RPCs are already generic over command_type.
alter type public.device_command_type add value if not exists 'enable_kiosk';
alter type public.device_command_type add value if not exists 'disable_kiosk_temporarily';
alter type public.device_command_type add value if not exists 'reenter_kiosk';

-- Per-device maintenance-exit window, alongside the existing per-device
-- maintenance_pin_hash/salt (20260807090000_kiosk_and_maintenance.sql).
-- Null means "use the app's own default" (RemoteConfigEntity.
-- DEFAULT_MAINTENANCE_TIMEOUT_SECONDS = 300) rather than baking a default
-- into every row up front.
alter table public.devices
  add column maintenance_timeout_seconds integer;

alter table public.devices
  add constraint devices_maintenance_timeout_check
  check (
    maintenance_timeout_seconds is null
    or maintenance_timeout_seconds between 60 and 1800
  );

comment on column public.devices.maintenance_timeout_seconds is
  'How long a temporary kiosk exit (physical PIN unlock or a disable_kiosk_temporarily command) lasts before Lock Task automatically re-engages. Null falls back to the app''s own 300s default.';

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in (
    'archive', 'restore', 'deactivate', 'reactivate', 'unlink', 'delete',
    'set_maintenance_pin', 'set_maintenance_timeout'
  )
);

create or replace function public.set_device_maintenance_timeout(
  p_device_id uuid,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_code text;
begin
  -- Same authorization bar as every other fleet-operational device
  -- mutation (create_device_command, archive_device, ...) — unlike the PIN
  -- itself (super_admin-only, since it gates physical access), a timeout
  -- duration is an operational tuning value, not a security secret.
  perform private.require_fleet_manager();
  if p_seconds is not null and (p_seconds < 60 or p_seconds > 1800) then
    raise exception using errcode = '22023', message = 'Timeout must be between 60 and 1800 seconds.';
  end if;

  select device_code into v_device_code from public.devices where id = p_device_id;
  if v_device_code is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  update public.devices
  set maintenance_timeout_seconds = p_seconds
  where id = p_device_id;

  perform private.record_audit_event(
    'set_maintenance_timeout', 'device', p_device_id, v_device_code, null, null
  );
end;
$$;

revoke all on function public.set_device_maintenance_timeout(uuid, integer) from public, anon;
grant execute on function public.set_device_maintenance_timeout(uuid, integer) to authenticated;

-- create or replace can't add columns to a table function's return type —
-- drop first, same pattern as every prior get_device_config revision.
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
  maintenance_pin_salt text,
  maintenance_timeout_seconds integer
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
    d.maintenance_pin_hash, d.maintenance_pin_salt, d.maintenance_timeout_seconds
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  cross join public.app_remote_config c
  where d.id = v_device_id;
end;
$$;

revoke all on function public.get_device_config(text) from public, anon, authenticated;
grant execute on function public.get_device_config(text) to service_role;
