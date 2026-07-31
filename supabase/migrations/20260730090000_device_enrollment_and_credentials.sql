-- MAX-006: device identity, enrollment and credentials for the Android
-- tablet. The device never touches Supabase Auth: it authenticates to the
-- device API (Edge Functions) with an opaque bearer token whose hash is the
-- only thing ever persisted. Enrollment codes are short-lived, single-use
-- and rate-limited so an admin can safely read one aloud or type it in.

create table public.device_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_enrollment_codes_attempts_check check (attempts >= 0 and attempts <= max_attempts + 5),
  constraint device_enrollment_codes_expiry_check check (expires_at > created_at)
);

create index device_enrollment_codes_device_id_idx
  on public.device_enrollment_codes (device_id);
-- At most one currently-usable (unused, unrevoked) code per device: a new
-- code request must revoke the previous one first.
create unique index device_enrollment_codes_one_active_per_device
  on public.device_enrollment_codes (device_id)
  where used_at is null and revoked_at is null;

create table public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  token_hash text not null unique,
  installation_id uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index device_credentials_device_id_idx
  on public.device_credentials (device_id);
-- At most one active (non-revoked) credential per device.
create unique index device_credentials_one_active_per_device
  on public.device_credentials (device_id)
  where revoked_at is null;

alter table public.device_enrollment_codes enable row level security;
alter table public.device_credentials enable row level security;

-- Neither table is exposed to PostgREST/RLS-scoped clients directly, not
-- even for reads: an authenticated admin session must go through the
-- SECURITY DEFINER functions below, and the Android device talks to the
-- Edge Functions (service_role), never to these tables over PostgREST.
revoke all on public.device_enrollment_codes from public, anon, authenticated;
revoke all on public.device_credentials from public, anon, authenticated;

create or replace function private.generate_friendly_code(p_length int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- Uppercase alnum without 0/O/1/I/L to avoid transcription mistakes.
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  bytes bytea;
begin
  bytes := extensions.gen_random_bytes(p_length);
  for i in 0 .. p_length - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

revoke all on function private.generate_friendly_code(int) from public, anon, authenticated;

create or replace function public.generate_device_enrollment_code(p_device_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_code text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('super_admin', 'admin', 'operations') then
    raise exception using errcode = '42501', message = 'Not authorized to generate enrollment codes.';
  end if;
  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  update public.device_enrollment_codes
  set revoked_at = now()
  where device_id = p_device_id and used_at is null and revoked_at is null;

  v_code := private.generate_friendly_code(8);
  insert into public.device_enrollment_codes (device_id, code_hash, expires_at, created_by)
  values (
    p_device_id,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    v_expires,
    auth.uid()
  );

  return query select v_code, v_expires;
end;
$$;

revoke all on function public.generate_device_enrollment_code(uuid) from public, anon;
grant execute on function public.generate_device_enrollment_code(uuid) to authenticated;

create or replace function public.revoke_device_enrollment_code(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('super_admin', 'admin', 'operations') then
    raise exception using errcode = '42501', message = 'Not authorized to revoke enrollment codes.';
  end if;
  update public.device_enrollment_codes
  set revoked_at = now()
  where device_id = p_device_id and used_at is null and revoked_at is null;
end;
$$;

revoke all on function public.revoke_device_enrollment_code(uuid) from public, anon;
grant execute on function public.revoke_device_enrollment_code(uuid) to authenticated;

create or replace function public.revoke_device_credential(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('super_admin', 'admin', 'operations') then
    raise exception using errcode = '42501', message = 'Not authorized to revoke device credentials.';
  end if;
  update public.device_credentials
  set revoked_at = now()
  where device_id = p_device_id and revoked_at is null;
end;
$$;

revoke all on function public.revoke_device_credential(uuid) from public, anon;
grant execute on function public.revoke_device_credential(uuid) to authenticated;

-- Admin-facing read model: current enrollment/credential state per device,
-- without ever exposing a code or token hash. Runs with the view owner's
-- privileges (not security_invoker) because device_credentials and
-- device_enrollment_codes intentionally grant no direct access to
-- `authenticated`; the role check below is the view's own gate instead of
-- relying on RLS on the underlying tables.
create view public.device_enrollment_admin_view
as
select
  d.id as device_id,
  d.device_code,
  (
    select ec.expires_at
    from public.device_enrollment_codes ec
    where ec.device_id = d.id and ec.used_at is null and ec.revoked_at is null and ec.expires_at > now()
    order by ec.created_at desc
    limit 1
  ) as pending_code_expires_at,
  (
    select ec.created_at
    from public.device_enrollment_codes ec
    where ec.device_id = d.id and ec.used_at is not null
    order by ec.used_at desc
    limit 1
  ) as last_enrollment_requested_at,
  (
    select dc.created_at
    from public.device_credentials dc
    where dc.device_id = d.id and dc.revoked_at is null
    limit 1
  ) as credential_issued_at,
  (
    select dc.last_used_at
    from public.device_credentials dc
    where dc.device_id = d.id and dc.revoked_at is null
    limit 1
  ) as credential_last_used_at,
  exists (
    select 1 from public.device_credentials dc
    where dc.device_id = d.id and dc.revoked_at is null
  ) as is_enrolled
from public.devices d
where private.current_app_role() in ('super_admin', 'admin', 'operations');

revoke all on public.device_enrollment_admin_view from public, anon;
grant select on public.device_enrollment_admin_view to authenticated;

comment on table public.device_enrollment_codes is
  'Short-lived, single-use activation codes an admin generates to enroll one physical tablet. Only a SHA-256 hash of the code is stored.';
comment on table public.device_credentials is
  'One active opaque bearer credential per device. Only a SHA-256 hash of the token is stored; the raw token is returned exactly once, at enrollment.';
comment on function public.generate_device_enrollment_code(uuid) is
  'Admin-facing RPC: mints a new 8-character enrollment code for a device, revoking any previous unused code.';
