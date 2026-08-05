-- MAX-010.6 follow-up: the Android enrollment screen collapsed every
-- rejection from device-enroll-key-start/-complete into one generic
-- "Código inválido ou já utilizado" message, whether the code was truly
-- unknown, had simply expired (a 15-minute window is tight against a
-- painel-generate-then-walk-to-the-tablet workflow), had already been
-- consumed, or had been auto-revoked by generating a second code — or
-- even when the *signature* step failed, unrelated to the code at all.
-- That ambiguity is exactly what made a real field failure (the code
-- expiring during diagnosis) look identical to a real bug from the
-- operator's side. This migration gives each distinct cause its own
-- application-level SQLSTATE (the 'MX0xx' range, unused elsewhere in this
-- schema) so the Edge Function — and, from there, the Android client —
-- can tell them apart without changing what's authenticated or who's
-- authorized to do what.

create or replace function public.start_device_key_enrollment(
  p_code text,
  p_installation_id uuid,
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

  -- Fetched by hash alone (no state filter) so the branches below can
  -- explain *why* a code doesn't qualify, instead of a single catch-all.
  select * into v_code_row
  from public.device_enrollment_codes ec
  where ec.code_hash = private.hash_token(upper(trim(p_code)));

  if v_code_row.id is null then
    raise exception using errcode = 'MX010', message = 'Enrollment code not found.';
  end if;
  if v_code_row.used_at is not null then
    raise exception using errcode = 'MX011', message = 'Enrollment code has already been used.';
  end if;
  if v_code_row.revoked_at is not null then
    raise exception using errcode = 'MX012', message = 'Enrollment code has been revoked.';
  end if;
  if v_code_row.expires_at <= now() then
    raise exception using errcode = 'MX013', message = 'Enrollment code has expired.';
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

-- Same distinction for the challenge itself expiring (the 5-minute
-- proof-of-possession window, separate from the 15-minute code window
-- above) at the complete step.
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
  where id = p_enrollment_attempt_id;
  if v_attempt.id is null then
    raise exception using errcode = '42501', message = 'Enrollment attempt not found.';
  end if;
  if v_attempt.expires_at <= now() and v_attempt.completed_at is null then
    raise exception using errcode = 'MX014', message = 'Enrollment challenge has expired.';
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
    raise exception using errcode = 'MX013', message = 'Enrollment code has expired.';
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
