-- MAX-013: hardens the maintenance PIN (6 digits exactly, bcrypt instead
-- of a bare sha256(pin||salt)) and adds an online remote temporary-code
-- fallback — a technician without the permanent PIN memorized (or a
-- one-off contractor who should never learn it) can get a short-lived,
-- single-use 6-digit code generated from the panel instead.
--
-- pgcrypto's crypt()/gen_salt('bf', 12) is bcrypt: adaptive cost (the
-- "12" can be raised later as hardware gets faster, unlike a bare
-- digest), purpose-built for password/PIN hashing, and self-contained
-- (the salt travels inside the hash string itself) — see
-- docs/architecture/DEVICE_KEY_AUTH.md and ANDROID_KIOSK.md for the
-- full write-up of why this replaces the old scheme rather than just
-- adding to it. maintenance_pin_hash_version distinguishes an
-- already-set v1 PIN (still validates, until rotated) from a new v2 one.

alter table public.devices
  add column maintenance_pin_hash_version integer not null default 1;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in (
    'archive', 'restore', 'deactivate', 'reactivate', 'unlink', 'delete',
    'set_maintenance_pin', 'set_maintenance_timeout', 'generate_maintenance_temp_code'
  )
);

comment on column public.devices.maintenance_pin_hash_version is
  '1 = legacy sha256(pin||salt) (maintenance_pin_salt populated). 2 = bcrypt, cost 12, self-contained (maintenance_pin_salt unused/null for v2).';

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
  v_hash text;
  v_device_code text;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can set a device maintenance PIN.';
  end if;
  -- MAX-013: exactly 6 digits now (was 4-8) — a fixed length keeps the
  -- Android input field and the "never reveal length" UX rule simple,
  -- and matches the new remote temporary code's own length.
  if p_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = '22023', message = 'PIN must be exactly 6 digits.';
  end if;

  select device_code into v_device_code from public.devices where id = p_device_id;
  if v_device_code is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 12));

  update public.devices
  set maintenance_pin_hash = v_hash,
      maintenance_pin_salt = null,
      maintenance_pin_hash_version = 2
  where id = p_device_id;

  perform private.record_audit_event(
    'set_maintenance_pin', 'device', p_device_id, v_device_code, null, null
  );
end;
$$;

-- device-config's output shape changed (one more column) — Postgres
-- won't let CREATE OR REPLACE change a table-returning function's
-- column list, same lesson as the record_device_heartbeat overload
-- issue this marco already fixed once (see DEVICE_KEY_AUTH.md).
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
  maintenance_pin_hash_version integer,
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
    d.maintenance_pin_hash, d.maintenance_pin_salt, d.maintenance_pin_hash_version,
    d.maintenance_timeout_seconds
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  cross join public.app_remote_config c
  where d.id = v_device_id;
end;
$$;

revoke all on function public.get_device_config(text) from public, anon, authenticated;
grant execute on function public.get_device_config(text) to service_role;

-- ==================================================================
-- Remote temporary maintenance code (MAX-013): a 6-digit, single-use,
-- 5-minute-TTL code generated from the panel — for a technician who
-- shouldn't learn the permanent PIN, or as a fallback when it's been
-- forgotten. Requires the tablet to be online (it's verified against
-- Cloud, never cached locally) — the permanent PIN remains the only
-- fully-offline path, by design (section 22 of the MAX-013 brief).
-- ==================================================================

create table public.device_maintenance_temp_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  code_hash text not null,
  reason text,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index device_maintenance_temp_codes_device_id_idx
  on public.device_maintenance_temp_codes(device_id);

alter table public.device_maintenance_temp_codes enable row level security;
grant select on public.device_maintenance_temp_codes to authenticated;

create policy device_maintenance_temp_codes_super_admin_select
  on public.device_maintenance_temp_codes
  for select
  to authenticated
  using (private.current_app_role() = 'super_admin');

-- No direct INSERT/UPDATE policy: only ever written through
-- generate_device_maintenance_temp_code/verify_device_maintenance_temp_code
-- below (SECURITY DEFINER), same pattern as maintenance_pin_hash itself.

create or replace function public.generate_device_maintenance_temp_code(
  p_device_id uuid,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_code text;
  v_code text;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can generate a temporary maintenance code.';
  end if;

  select device_code into v_device_code from public.devices where id = p_device_id;
  if v_device_code is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  -- Six digits, uniformly distributed: floor(random()*1000000), zero-padded.
  -- random() is pg_catalog, always resolvable regardless of search_path.
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into public.device_maintenance_temp_codes (device_id, code_hash, reason, created_by, expires_at)
  values (
    p_device_id,
    extensions.crypt(v_code, extensions.gen_salt('bf', 12)),
    p_reason,
    auth.uid(),
    now() + interval '5 minutes'
  );

  perform private.record_audit_event(
    'generate_maintenance_temp_code', 'device', p_device_id, v_device_code,
    p_reason, null, jsonb_build_object('expires_in_minutes', 5)
  );

  -- The only place the plaintext code ever exists — returned once to the
  -- admin who requested it, never stored, never logged.
  return v_code;
end;
$$;

revoke all on function public.generate_device_maintenance_temp_code(uuid, text) from public, anon;
grant execute on function public.generate_device_maintenance_temp_code(uuid, text) to authenticated;

-- Called by the device (online only) via a new signed edge function,
-- device-verify-maintenance-code — same v2 bridge-token pattern as
-- every other device-* endpoint. Single-use: the first matching,
-- unexpired, unused code succeeds and is immediately marked used_at;
-- everything else (wrong code, expired, already used, wrong device)
-- fails identically, never revealing which.
create or replace function public.verify_device_maintenance_temp_code(
  p_token text,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_match_id uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  select id into v_match_id
  from public.device_maintenance_temp_codes
  where device_id = v_device_id
    and used_at is null
    and expires_at > now()
    and code_hash = extensions.crypt(p_code, code_hash)
  order by created_at desc
  limit 1;

  if v_match_id is null then
    return false;
  end if;

  update public.device_maintenance_temp_codes
  set used_at = now()
  where id = v_match_id;

  return true;
end;
$$;

revoke all on function public.verify_device_maintenance_temp_code(text, text) from public, anon, authenticated;
grant execute on function public.verify_device_maintenance_temp_code(text, text) to service_role;
