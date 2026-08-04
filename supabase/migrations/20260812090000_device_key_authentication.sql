-- MAX-010.6: cryptographic device identity, replacing the static bearer
-- token as the long-lived secret. The Android tablet generates an EC
-- P-256 key pair inside the Android Keystore; the private key material
-- never leaves the device and this schema only ever stores the public
-- key. Every device-facing request is signed; the server verifies the
-- signature (in the Edge Function, using Web Crypto — Postgres has no
-- native ECDSA verify) and only then calls
-- private.mint_device_session_token to bridge into the *existing*,
-- unmodified v1 token-resolution path (private.device_id_for_token),
-- so none of the already-tested device-facing RPCs need to change at
-- all. See docs/architecture/DEVICE_KEY_AUTH.md for the full request
-- flow and threat model.

create table public.device_key_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  key_id uuid not null unique default gen_random_uuid(),
  public_key_der bytea not null,
  public_key_fingerprint text not null unique,
  algorithm text not null default 'ECDSA_P256_SHA256',
  hardware_backed boolean,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid references public.device_key_credentials (id),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  constraint device_key_credentials_algorithm_check check (algorithm = 'ECDSA_P256_SHA256')
);

create index device_key_credentials_device_id_idx
  on public.device_key_credentials (device_id);
-- At most one active (non-revoked) key per device, mirroring
-- device_credentials_one_active_per_device for the same reason.
create unique index device_key_credentials_one_active_per_device
  on public.device_key_credentials (device_id)
  where revoked_at is null;

-- Pending proof-of-possession challenges issued by
-- start_device_key_enrollment, resolved by complete_device_key_enrollment.
-- Never exposes the enrollment code itself, only which code row it's tied
-- to, so the code stays single-use even across a failed/abandoned attempt.
create table private.device_key_enrollment_challenges (
  id uuid primary key default gen_random_uuid(),
  enrollment_code_id uuid not null references public.device_enrollment_codes (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  installation_id uuid not null,
  public_key_der bytea not null,
  public_key_fingerprint text not null,
  algorithm text not null,
  hardware_backed boolean,
  app_version text,
  manufacturer text,
  model text,
  android_version text,
  challenge bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint device_key_enrollment_challenges_expiry_check check (expires_at > created_at)
);

create index device_key_enrollment_challenges_code_idx
  on private.device_key_enrollment_challenges (enrollment_code_id);

-- Nonce replay protection: one row per (key_id, nonce) ever accepted.
-- Short retention is enough since requests are also timestamp-bounded —
-- a nonce older than the timestamp tolerance can never be replayed
-- successfully anyway, so cleanup only needs to keep pace loosely.
create table private.device_key_request_nonces (
  key_id uuid not null references public.device_key_credentials (key_id) on delete cascade,
  nonce text not null,
  created_at timestamptz not null default now(),
  primary key (key_id, nonce)
);

create index device_key_request_nonces_created_at_idx
  on private.device_key_request_nonces (created_at);

-- Single-use, very-short-lived bridge token: minted only after a request
-- signature has already been verified, so its sole purpose is letting the
-- Edge Function hand off to the unmodified v1 RPCs (which resolve a
-- device_id from an opaque token, never a client-asserted one) without
-- duplicating their logic. Never returned to the client, never logged.
create table private.device_key_session_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  key_id uuid not null references public.device_key_credentials (key_id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  expires_at timestamptz not null
);

alter table public.device_key_credentials enable row level security;
alter table private.device_key_enrollment_challenges enable row level security;
alter table private.device_key_request_nonces enable row level security;
alter table private.device_key_session_tokens enable row level security;

revoke all on public.device_key_credentials from public, anon, authenticated;
-- private schema tables already default to no PostgREST exposure; explicit
-- revoke here documents the intent the same way the public.* tables do.
revoke all on private.device_key_enrollment_challenges from public, anon, authenticated;
revoke all on private.device_key_request_nonces from public, anon, authenticated;
revoke all on private.device_key_session_tokens from public, anon, authenticated;

-- ==================================================================
-- Enrollment: start (validate code + record challenge, code NOT yet
-- consumed) / complete (re-validate, verify already happened in the
-- Edge Function, consume code + activate key, all in one transaction).
-- ==================================================================

-- A prior draft of this migration took p_public_key_der as bytea; changing
-- a parameter *type* makes CREATE OR REPLACE silently create a second
-- overload instead of replacing anything, so the stale signature is
-- dropped explicitly rather than left as ambiguous dead weight.
drop function if exists public.start_device_key_enrollment(
  text, uuid, bytea, text, text, boolean, text, text, text, text
);
create or replace function public.start_device_key_enrollment(
  p_code text,
  p_installation_id uuid,
  -- Base64 (never raw bytea) at every RPC boundary in this file,
  -- deliberately: PostgREST/postgrest-js's default bytea wire format
  -- (hex-with-\x-prefix on the way out, and no implicit base64 decode on
  -- the way in) is exactly the kind of implicit-format assumption that's
  -- easy to get subtly wrong across a Deno caller and a Kotlin caller.
  -- Encoding/decoding explicitly here means this file is the only place
  -- that has to agree with itself.
  p_public_key_der text,
  p_public_key_fingerprint text,
  p_algorithm text,
  p_hardware_backed boolean default null,
  p_app_version text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_android_version text default null
)
returns table (
  enrollment_attempt_id uuid,
  challenge text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_failures integer;
  v_code_row public.device_enrollment_codes%rowtype;
  v_public_key_der bytea;
  v_challenge bytea;
  v_expires timestamptz := now() + interval '5 minutes';
  v_attempt_id uuid;
begin
  if p_installation_id is null then
    raise exception using errcode = '22023', message = 'installation_id is required.';
  end if;
  if p_public_key_der is null or length(p_public_key_der) = 0 then
    raise exception using errcode = '22023', message = 'public key is required.';
  end if;
  if p_algorithm is distinct from 'ECDSA_P256_SHA256' then
    raise exception using errcode = '22023', message = 'Unsupported key algorithm.';
  end if;

  begin
    v_public_key_der := decode(p_public_key_der, 'base64');
  exception when others then
    raise exception using errcode = '22023', message = 'public key must be base64-encoded.';
  end;
  if octet_length(v_public_key_der) = 0 then
    raise exception using errcode = '22023', message = 'public key is required.';
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
  from public.device_enrollment_codes ec
  where ec.code_hash = private.hash_token(upper(trim(p_code)))
    and ec.used_at is null
    and ec.revoked_at is null
    and ec.expires_at > now();
  if v_code_row.id is null then
    raise exception using errcode = '42501', message = 'Enrollment code is invalid, expired or already used.';
  end if;

  v_challenge := extensions.gen_random_bytes(32);
  insert into private.device_key_enrollment_challenges (
    enrollment_code_id, device_id, installation_id, public_key_der,
    public_key_fingerprint, algorithm, hardware_backed, app_version,
    manufacturer, model, android_version, challenge, expires_at
  ) values (
    v_code_row.id, v_code_row.device_id, p_installation_id, v_public_key_der,
    p_public_key_fingerprint, p_algorithm, p_hardware_backed, p_app_version,
    p_manufacturer, p_model, p_android_version, v_challenge, v_expires
  )
  returning id into v_attempt_id;

  return query select v_attempt_id, encode(v_challenge, 'base64'), v_expires;
end;
$$;

revoke all on function public.start_device_key_enrollment(
  text, uuid, text, text, text, boolean, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.start_device_key_enrollment(
  text, uuid, text, text, text, boolean, text, text, text, text
) to service_role;

-- Lets the Edge Function fetch what it needs to verify the challenge
-- signature before ever calling complete_device_key_enrollment — kept
-- separate from that function so a failed/abandoned verification never
-- touches the enrollment code or creates any credential.
create or replace function public.get_device_key_enrollment_challenge(
  p_enrollment_attempt_id uuid
)
returns table (
  public_key_der text,
  challenge text,
  expires_at timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    encode(public_key_der, 'base64'),
    encode(challenge, 'base64'),
    expires_at,
    completed_at
  from private.device_key_enrollment_challenges
  where id = p_enrollment_attempt_id;
$$;

revoke all on function public.get_device_key_enrollment_challenge(uuid) from public, anon, authenticated;
grant execute on function public.get_device_key_enrollment_challenge(uuid) to service_role;

-- Called only after the Edge Function has already verified, with Web
-- Crypto, that the signature over `challenge` validates against
-- public_key_der — this function trusts that verification happened
-- (it's SECURITY DEFINER, callable only by service_role, exactly like
-- enroll_device already is) rather than repeating ECDSA verification in
-- PL/pgSQL, which Postgres has no native support for.
create or replace function public.complete_device_key_enrollment(
  p_enrollment_attempt_id uuid
)
returns table (
  device_id uuid,
  device_code text,
  key_id uuid,
  vehicle_id uuid,
  vehicle_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.device_key_enrollment_challenges%rowtype;
  v_code_row public.device_enrollment_codes%rowtype;
  v_existing_key_id uuid;
begin
  select * into v_attempt
  from private.device_key_enrollment_challenges
  where id = p_enrollment_attempt_id and expires_at > now();
  if v_attempt.id is null then
    raise exception using errcode = '42501', message = 'Enrollment attempt not found or expired.';
  end if;

  -- Idempotent replay of an already-completed attempt (e.g. the Android
  -- client retried after a timeout on the first response): return the
  -- same success result instead of erroring, per MAX-010.6 section 9.
  if v_attempt.completed_at is not null then
    select dkc.key_id into v_existing_key_id
    from public.device_key_credentials dkc
    where dkc.device_id = v_attempt.device_id
      and dkc.public_key_fingerprint = v_attempt.public_key_fingerprint
      and dkc.revoked_at is null;
    if v_existing_key_id is not null then
      return query
      select d.id, d.device_code, v_existing_key_id, d.vehicle_id, v.internal_code
      from public.devices d
      left join public.vehicles v on v.id = d.vehicle_id
      where d.id = v_attempt.device_id;
      return;
    end if;
    raise exception using errcode = '42501', message = 'Enrollment attempt already completed.';
  end if;

  select * into v_code_row
  from public.device_enrollment_codes
  where id = v_attempt.enrollment_code_id
    and used_at is null
    and revoked_at is null
    and expires_at > now();
  if v_code_row.id is null then
    raise exception using errcode = '42501', message = 'Enrollment code is invalid, expired or already used.';
  end if;

  update public.device_enrollment_codes
  set used_at = now()
  where id = v_code_row.id;

  -- Migration off v1: any existing static bearer token for this device is
  -- revoked the moment a key credential replaces it (MAX-010.6 section 15
  -- — no lingering fallback once the key is active).
  update public.device_credentials
  set revoked_at = now()
  where device_credentials.device_id = v_attempt.device_id and revoked_at is null;

  update public.device_key_credentials
  set revoked_at = now(), replaced_by = null
  where device_key_credentials.device_id = v_attempt.device_id and revoked_at is null;

  insert into public.device_key_credentials as dkc (
    device_id, public_key_der, public_key_fingerprint, algorithm,
    hardware_backed, activated_at, created_by
  ) values (
    v_attempt.device_id, v_attempt.public_key_der, v_attempt.public_key_fingerprint,
    v_attempt.algorithm, v_attempt.hardware_backed, now(), null
  )
  returning dkc.key_id into v_existing_key_id;

  update private.device_key_enrollment_challenges
  set completed_at = now()
  where id = v_attempt.id;

  update public.devices
  set
    status = case when status = 'provisioning' then 'online' else status end,
    app_version = coalesce(v_attempt.app_version, app_version),
    last_seen_at = now()
  where id = v_attempt.device_id;

  return query
  select d.id, d.device_code, v_existing_key_id, d.vehicle_id, v.internal_code
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  where d.id = v_attempt.device_id;
end;
$$;

revoke all on function public.complete_device_key_enrollment(uuid) from public, anon, authenticated;
grant execute on function public.complete_device_key_enrollment(uuid) to service_role;

-- ==================================================================
-- Recovery: if a device's local metadata (deviceId/keyId — non-secret,
-- but still just app-writable local storage) is ever lost while the
-- Keystore-resident key itself is intact, the app can re-derive its own
-- public key and fingerprint from the Keystore at any time with no
-- stored state at all, then prove possession of it again to recover
-- keyId/deviceId — without ever needing a new human-typed code. This is
-- the direct answer to MAX-011's original finding: local metadata
-- storage on some hardware has proven unreliable; the Keystore key
-- itself has not.
-- ==================================================================

create table private.device_key_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.device_key_credentials (key_id) on delete cascade,
  challenge bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint device_key_recovery_challenges_expiry_check check (expires_at > created_at)
);

alter table private.device_key_recovery_challenges enable row level security;
revoke all on private.device_key_recovery_challenges from public, anon, authenticated;

create or replace function public.start_device_key_recovery(
  p_public_key_fingerprint text
)
returns table (
  recovery_attempt_id uuid,
  challenge text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id uuid;
  v_challenge bytea;
  v_expires timestamptz := now() + interval '5 minutes';
  v_attempt_id uuid;
begin
  select dkc.key_id into v_key_id
  from public.device_key_credentials dkc
  where dkc.public_key_fingerprint = p_public_key_fingerprint
    and dkc.revoked_at is null;
  if v_key_id is null then
    -- Deliberately the same message a truly unknown key would get: this
    -- endpoint never confirms or denies that a *particular* fingerprint
    -- belongs to a real, currently-active device to an unauthenticated
    -- caller beyond what completing the challenge would already prove.
    raise exception using errcode = '42501', message = 'Unknown or revoked device key.';
  end if;

  v_challenge := extensions.gen_random_bytes(32);
  insert into private.device_key_recovery_challenges (key_id, challenge, expires_at)
  values (v_key_id, v_challenge, v_expires)
  returning id into v_attempt_id;

  return query select v_attempt_id, encode(v_challenge, 'base64'), v_expires;
end;
$$;

revoke all on function public.start_device_key_recovery(text) from public, anon, authenticated;
grant execute on function public.start_device_key_recovery(text) to service_role;

create or replace function public.get_device_key_recovery_challenge(
  p_recovery_attempt_id uuid
)
returns table (
  public_key_der text,
  challenge text,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    encode(dkc.public_key_der, 'base64'),
    encode(rc.challenge, 'base64'),
    rc.expires_at
  from private.device_key_recovery_challenges rc
  join public.device_key_credentials dkc on dkc.key_id = rc.key_id
  where rc.id = p_recovery_attempt_id and dkc.revoked_at is null;
$$;

revoke all on function public.get_device_key_recovery_challenge(uuid) from public, anon, authenticated;
grant execute on function public.get_device_key_recovery_challenge(uuid) to service_role;

-- Trusts the Edge Function's prior signature verification exactly like
-- complete_device_key_enrollment does — never creates or changes any
-- credential, purely confirms "this caller still holds the private key"
-- and hands back the same non-secret identifiers the original enrollment
-- returned.
create or replace function public.complete_device_key_recovery(
  p_recovery_attempt_id uuid
)
returns table (
  device_id uuid,
  device_code text,
  key_id uuid,
  vehicle_id uuid,
  vehicle_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.device_key_recovery_challenges%rowtype;
  v_key_id uuid;
  v_device_id uuid;
begin
  select * into v_attempt
  from private.device_key_recovery_challenges
  where id = p_recovery_attempt_id and expires_at > now();
  if v_attempt.id is null then
    raise exception using errcode = '42501', message = 'Recovery attempt not found or expired.';
  end if;

  select dkc.key_id, dkc.device_id into v_key_id, v_device_id
  from public.device_key_credentials dkc
  where dkc.key_id = v_attempt.key_id and dkc.revoked_at is null;
  if v_key_id is null then
    raise exception using errcode = '42501', message = 'This device key has since been revoked.';
  end if;

  update private.device_key_recovery_challenges
  set completed_at = now()
  where id = v_attempt.id;

  update public.device_key_credentials
  set last_used_at = now()
  where device_key_credentials.key_id = v_key_id;

  return query
  select d.id, d.device_code, v_key_id, d.vehicle_id, v.internal_code
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  where d.id = v_device_id;
end;
$$;

revoke all on function public.complete_device_key_recovery(uuid) from public, anon, authenticated;
grant execute on function public.complete_device_key_recovery(uuid) to service_role;

-- ==================================================================
-- Per-request verification support, called from every signed device
-- endpoint's Edge Function before it does its own ECDSA verification.
-- ==================================================================

drop function if exists public.get_device_key_for_verification(uuid);
create or replace function public.get_device_key_for_verification(p_key_id uuid)
returns table (
  device_id uuid,
  public_key_der text,
  revoked_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select device_id, encode(public_key_der, 'base64'), revoked_at
  from public.device_key_credentials
  where key_id = p_key_id;
$$;

revoke all on function public.get_device_key_for_verification(uuid) from public, anon, authenticated;
grant execute on function public.get_device_key_for_verification(uuid) to service_role;

-- Atomic replay check: the primary key (key_id, nonce) does the real work,
-- a unique-violation means the nonce was already used. Called only after
-- signature verification already succeeded, so a failed insert here is
-- unambiguously a replay attempt, not a forgery attempt.
create or replace function public.check_and_record_device_nonce(
  p_key_id uuid,
  p_nonce text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.device_key_request_nonces (key_id, nonce)
  values (p_key_id, p_nonce);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke all on function public.check_and_record_device_nonce(uuid, text) from public, anon, authenticated;
grant execute on function public.check_and_record_device_nonce(uuid, text) to service_role;

-- Bridges a verified signed request into the *existing*, unmodified v1
-- token-resolution path (private.device_id_for_token, extended below to
-- recognize these tokens) — see this file's header comment for why.
create or replace function public.mint_device_session_token(p_key_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_token text;
begin
  select device_id into v_device_id
  from public.device_key_credentials
  where key_id = p_key_id and revoked_at is null;
  if v_device_id is null then
    raise exception using errcode = '42501', message = 'Unknown or revoked device key.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.device_key_session_tokens (device_id, key_id, token_hash, expires_at)
  values (v_device_id, p_key_id, private.hash_token(v_token), now() + interval '60 seconds');

  update public.device_key_credentials
  set last_used_at = now()
  where key_id = p_key_id;

  return v_token;
end;
$$;

revoke all on function public.mint_device_session_token(uuid) from public, anon, authenticated;
grant execute on function public.mint_device_session_token(uuid) to service_role;

-- Extends the single v1 token-resolution chokepoint (used by every
-- existing device-facing RPC) to also recognize a v2 session token,
-- instead of touching any of those RPCs individually. A device_id
-- resolved this way already passed real ECDSA signature verification
-- earlier in the same request — this lookup is a single-use, ~seconds-
-- lived handoff, not a second independent trust decision.
create or replace function private.device_id_for_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_hash text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception using errcode = '42501', message = 'Invalid device credential.';
  end if;
  v_hash := private.hash_token(p_token);

  select device_id into v_device_id
  from public.device_credentials
  where token_hash = v_hash and revoked_at is null;
  if v_device_id is not null then
    update public.device_credentials set last_used_at = now() where token_hash = v_hash;
    return v_device_id;
  end if;

  select device_id into v_device_id
  from private.device_key_session_tokens
  where token_hash = v_hash and used_at is null and expires_at > now();
  if v_device_id is not null then
    update private.device_key_session_tokens set used_at = now() where token_hash = v_hash;
    return v_device_id;
  end if;

  raise exception using errcode = '42501', message = 'Invalid or revoked device credential.';
end;
$$;

-- ==================================================================
-- Admin-facing: revocation, replacement, read model.
-- ==================================================================

create or replace function public.revoke_device_key(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() not in ('super_admin', 'admin', 'operations') then
    raise exception using errcode = '42501', message = 'Not authorized to revoke device keys.';
  end if;
  update public.device_key_credentials
  set revoked_at = now()
  where device_id = p_device_id and revoked_at is null;
end;
$$;

revoke all on function public.revoke_device_key(uuid) from public, anon;
grant execute on function public.revoke_device_key(uuid) to authenticated;

create or replace view public.device_key_admin_view
as
select
  d.id as device_id,
  d.device_code,
  dkc.key_id,
  dkc.public_key_fingerprint,
  dkc.algorithm,
  dkc.hardware_backed,
  dkc.created_at as key_created_at,
  dkc.activated_at as key_activated_at,
  dkc.last_used_at as key_last_used_at,
  (dkc.id is not null and dkc.revoked_at is null) as has_active_key,
  exists (
    select 1 from public.device_credentials dc
    where dc.device_id = d.id and dc.revoked_at is null
  ) as has_active_legacy_token
from public.devices d
left join public.device_key_credentials dkc
  on dkc.device_id = d.id and dkc.revoked_at is null
where private.current_app_role() in ('super_admin', 'admin', 'operations');

revoke all on public.device_key_admin_view from public, anon;
grant select on public.device_key_admin_view to authenticated;

-- Cheap, low-cardinality cleanup: nonces and session tokens are only ever
-- meaningful for a few minutes past their creation/expiry, so a wide
-- retention window here is purely about not growing these tables
-- unbounded over a long pilot, not a security control.
create or replace function private.cleanup_expired_device_key_artifacts()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.device_key_request_nonces where created_at < now() - interval '1 day';
  delete from private.device_key_session_tokens where expires_at < now() - interval '1 day';
  delete from private.device_key_enrollment_challenges where expires_at < now() - interval '1 day';
  delete from private.device_key_recovery_challenges where expires_at < now() - interval '1 day';
$$;

revoke all on function private.cleanup_expired_device_key_artifacts() from public, anon, authenticated;

comment on table public.device_key_credentials is
  'One active Keystore-backed EC public key per device (MAX-010.6) — the private key never leaves the tablet. Replaces the static bearer token in device_credentials as the long-lived secret; device_credentials stays for v1 compatibility only.';
comment on function public.mint_device_session_token(uuid) is
  'Issues a ~60s single-use opaque token immediately after a signed request''s ECDSA signature has already been verified, purely to bridge into the unmodified v1 RPCs via private.device_id_for_token — never returned to any client.';
