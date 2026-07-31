-- MAX-006: the minimal server surface the Android tablet talks to. All
-- three RPCs below are called exclusively by the device Edge Functions,
-- authenticated with their own elevated service credential (never by
-- anon/authenticated over PostgREST); each one re-derives the device
-- identity itself by hashing the caller's token, so the Android app can
-- never claim an arbitrary device_id.

-- Idempotency: a device may retry a heartbeat after a dropped response.
alter table public.device_heartbeats
  add column if not exists client_event_id uuid;

create unique index if not exists device_heartbeats_device_client_event_unique
  on public.device_heartbeats (device_id, client_event_id)
  where client_event_id is not null;

-- Simple, server-controlled remote config. A single row today; per-device
-- overrides can be added later without changing the device API contract.
create table public.app_remote_config (
  id boolean primary key default true,
  heartbeat_interval_seconds integer not null default 900,
  sync_interval_seconds integer not null default 3600,
  kiosk_enabled boolean not null default false,
  logging_level text not null default 'info',
  config_version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint app_remote_config_singleton check (id),
  constraint app_remote_config_heartbeat_interval_check check (heartbeat_interval_seconds >= 300),
  constraint app_remote_config_sync_interval_check check (sync_interval_seconds >= 300),
  constraint app_remote_config_logging_level_check check (logging_level in ('debug', 'info', 'warn', 'error'))
);

insert into public.app_remote_config (id) values (true);

alter table public.app_remote_config enable row level security;
revoke all on public.app_remote_config from public, anon;
create policy app_remote_config_staff_read on public.app_remote_config
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'));
grant select on public.app_remote_config to authenticated;

create trigger app_remote_config_set_updated_at before update on public.app_remote_config
  for each row execute function public.set_updated_at();

-- Coarse brute-force throttle for enrollment: the code's own entropy
-- (~40 bits, 15-minute expiry) already makes guessing impractical, but a
-- misbehaving or compromised client shouldn't be able to hammer the
-- endpoint. Keyed by the client-supplied installation_id, not IP, since the
-- Edge Function may sit behind a shared egress IP.
create table public.device_enrollment_attempts (
  id bigint generated always as identity primary key,
  installation_id uuid not null,
  succeeded boolean not null,
  occurred_at timestamptz not null default now()
);

create index device_enrollment_attempts_installation_idx
  on public.device_enrollment_attempts (installation_id, occurred_at desc);

alter table public.device_enrollment_attempts enable row level security;
revoke all on public.device_enrollment_attempts from public, anon, authenticated;

-- Logs one enrollment attempt for throttling. Deliberately its own
-- function, called independently by the Edge Function rather than from
-- inside enroll_device: a RAISE EXCEPTION rolls back everything done
-- earlier in the same call, so a log write for a *failed* attempt would
-- otherwise vanish along with the exception that reports the failure.
create or replace function public.record_device_enrollment_attempt(
  p_installation_id uuid,
  p_succeeded boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.device_enrollment_attempts (installation_id, succeeded)
  select p_installation_id, p_succeeded
  where p_installation_id is not null;
$$;

revoke all on function public.record_device_enrollment_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_device_enrollment_attempt(uuid, boolean) to service_role;

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

revoke all on function private.hash_token(text) from public, anon, authenticated;

-- Resolves a bearer token to its device, or raises. Centralizes the check
-- so enroll/heartbeat/config can't each drift on what "valid" means.
create or replace function private.device_id_for_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = '42501', message = 'Invalid device credential.';
  end if;
  select device_id into v_device_id
  from public.device_credentials
  where token_hash = private.hash_token(p_token) and revoked_at is null;
  if v_device_id is null then
    raise exception using errcode = '42501', message = 'Invalid or revoked device credential.';
  end if;
  update public.device_credentials
  set last_used_at = now()
  where device_id = v_device_id and revoked_at is null;
  return v_device_id;
end;
$$;

revoke all on function private.device_id_for_token(text) from public, anon, authenticated;

create or replace function public.enroll_device(
  p_code text,
  p_installation_id uuid,
  p_app_version text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_android_version text default null
)
returns table (
  device_token text,
  device_id uuid,
  device_code text,
  vehicle_id uuid,
  vehicle_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_failures integer;
  v_code_row public.device_enrollment_codes%rowtype;
  v_token text;
begin
  if p_installation_id is null then
    raise exception using errcode = '22023', message = 'installation_id is required.';
  end if;

  select count(*) into v_recent_failures
  from public.device_enrollment_attempts
  where installation_id = p_installation_id
    and succeeded = false
    and occurred_at > now() - interval '15 minutes';
  if v_recent_failures >= 10 then
    raise exception using errcode = '23514', message = 'Too many enrollment attempts. Try again later.';
  end if;

  select * into v_code_row
  from public.device_enrollment_codes
  where code_hash = private.hash_token(upper(trim(p_code)))
    and used_at is null
    and revoked_at is null
    and expires_at > now();

  if v_code_row.id is null then
    -- Logging this failure is the caller's job (record_device_enrollment_attempt):
    -- an insert here would be undone by the exception below rolling back
    -- everything this function did.
    raise exception using errcode = '42501', message = 'Enrollment code is invalid, expired or already used.';
  end if;

  update public.device_enrollment_codes
  set used_at = now()
  where id = v_code_row.id;

  update public.device_credentials
  set revoked_at = now()
  where device_credentials.device_id = v_code_row.device_id and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.device_credentials (device_id, token_hash, installation_id)
  values (v_code_row.device_id, private.hash_token(v_token), p_installation_id);

  update public.devices
  set
    status = case when status = 'provisioning' then 'online' else status end,
    app_version = coalesce(p_app_version, app_version),
    last_seen_at = now()
  where id = v_code_row.device_id;

  return query
  select
    v_token,
    d.id,
    d.device_code,
    d.vehicle_id,
    v.internal_code
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  where d.id = v_code_row.device_id;
end;
$$;

revoke all on function public.enroll_device(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enroll_device(text, uuid, text, text, text, text) to service_role;

create or replace function public.record_device_heartbeat(
  p_token text,
  p_battery_level smallint default null,
  p_network_type text default 'offline',
  p_storage_free_bytes bigint default null,
  p_app_version text default null,
  p_device_time timestamptz default null,
  p_client_event_id uuid default null
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
begin
  v_device_id := private.device_id_for_token(p_token);

  insert into public.device_heartbeats (
    device_id, recorded_at, battery_level, network_connected, gps_available,
    storage_free_bytes, app_version, client_event_id
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, false,
    p_storage_free_bytes, p_app_version, p_client_event_id
  )
  on conflict (device_id, client_event_id) where client_event_id is not null
  do nothing
  returning device_heartbeats.recorded_at into v_recorded_at;

  if v_recorded_at is null then
    -- A retried client_event_id: report the original heartbeat's time
    -- instead of a fresh one, since nothing new was written.
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

comment on function public.record_device_heartbeat(text, smallint, text, bigint, text, timestamptz, uuid) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock.';

revoke all on function public.record_device_heartbeat(text, smallint, text, bigint, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(text, smallint, text, bigint, text, timestamptz, uuid) to service_role;

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
  config_version integer
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
    c.logging_level, c.config_version
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  cross join public.app_remote_config c
  where d.id = v_device_id;
end;
$$;

revoke all on function public.get_device_config(text) from public, anon, authenticated;
grant execute on function public.get_device_config(text) to service_role;
