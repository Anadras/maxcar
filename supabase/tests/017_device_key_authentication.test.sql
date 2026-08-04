begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(36);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('d1000000-0000-4000-8000-000000000001', 'ops17@example.test', '{}', now(), now());
update public.profiles set role = 'operations' where id = 'd1000000-0000-4000-8000-000000000001';

insert into public.devices (id, device_code, status) values
  ('d1000000-0000-4000-8000-000000000020', 'TB-M11F-01', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('d1000000-0000-4000-8000-000000000020', encode(digest('DEVKEY01', 'sha256'), 'hex'), now() + interval '15 minutes');

-- ==================================================================
-- start_device_key_enrollment
-- ==================================================================

select throws_ok(
  $$select public.start_device_key_enrollment(
      'wrongcode', 'd2000000-0000-4000-8000-000000000001',
      encode('\x1234'::bytea, 'base64'), 'fp1', 'ECDSA_P256_SHA256'
    )$$,
  '42501',
  'Enrollment code is invalid, expired or already used.',
  'an unknown code is rejected'
);

select throws_ok(
  $$select public.start_device_key_enrollment(
      'devkey01', 'd2000000-0000-4000-8000-000000000001',
      encode('\x1234'::bytea, 'base64'), 'fp1', 'RSA_2048'
    )$$,
  '22023',
  'Unsupported key algorithm.',
  'a non-ECDSA algorithm is rejected'
);

select * from public.start_device_key_enrollment(
    'devkey01', 'd2000000-0000-4000-8000-000000000001',
    encode('\xaabbcc'::bytea, 'base64'), 'fp-test-1', 'ECDSA_P256_SHA256', true,
    '1.0.0', 'Acme', 'Tab7', '15'
  ) \gset attempt_
select ok(:'attempt_enrollment_attempt_id'::uuid is not null, 'start returns an attempt id');
select ok(octet_length(decode(:'attempt_challenge', 'base64')) = 32, 'the challenge is 32 random bytes');

select * from public.get_device_key_enrollment_challenge(:'attempt_enrollment_attempt_id'::uuid) \gset fetched_
select is(
  :'fetched_challenge'::text,
  :'attempt_challenge'::text,
  'get_device_key_enrollment_challenge returns the same challenge start issued'
);
select is(
  decode(:'fetched_public_key_der', 'base64'),
  '\xaabbcc'::bytea,
  'get_device_key_enrollment_challenge returns the public key the device submitted'
);
select is(
  (select used_at from public.device_enrollment_codes
   where device_id = 'd1000000-0000-4000-8000-000000000020'),
  null,
  'the enrollment code is NOT consumed yet by start alone'
);

-- ==================================================================
-- complete_device_key_enrollment
-- ==================================================================

select throws_ok(
  $$select public.complete_device_key_enrollment('00000000-0000-4000-8000-000000000000')$$,
  '42501',
  'Enrollment attempt not found or expired.',
  'completing an unknown attempt fails'
);

select * from public.complete_device_key_enrollment(:'attempt_enrollment_attempt_id'::uuid) \gset result_
select is(:'result_device_id'::text, 'd1000000-0000-4000-8000-000000000020', 'complete resolves the correct device');
select is(:'result_device_code'::text, 'TB-M11F-01', 'complete returns the device code');
select ok(:'result_key_id'::uuid is not null, 'complete returns a key_id');

select is(
  (select used_at is not null from public.device_enrollment_codes
   where device_id = 'd1000000-0000-4000-8000-000000000020'),
  true,
  'the enrollment code is consumed once the key is actually activated'
);
select is(
  (select count(*)::integer from public.device_key_credentials
   where device_id = 'd1000000-0000-4000-8000-000000000020' and revoked_at is null),
  1,
  'exactly one active key credential now exists for the device'
);
select is(
  (select status from public.devices where id = 'd1000000-0000-4000-8000-000000000020'),
  'online',
  'a provisioning device flips to online once its key activates'
);

-- Idempotent replay of the same completed attempt.
select lives_ok(
  format($$select public.complete_device_key_enrollment(%L)$$, :'attempt_enrollment_attempt_id'),
  'completing an already-completed attempt is idempotent, not an error'
);
select is(
  (select count(*)::integer from public.device_key_credentials
   where device_id = 'd1000000-0000-4000-8000-000000000020'),
  1,
  'the idempotent replay does not create a second key credential'
);

-- Re-using the same (now-consumed) code for a second start fails cleanly.
select throws_ok(
  $$select public.start_device_key_enrollment(
      'devkey01', 'd2000000-0000-4000-8000-000000000002',
      encode('\xddeeff'::bytea, 'base64'), 'fp-test-2', 'ECDSA_P256_SHA256'
    )$$,
  '42501',
  'Enrollment code is invalid, expired or already used.',
  'the consumed code cannot start a second enrollment attempt'
);

-- ==================================================================
-- Per-request verification support
-- ==================================================================

select is(
  (select device_id from public.get_device_key_for_verification(:'result_key_id'::uuid)),
  'd1000000-0000-4000-8000-000000000020'::uuid,
  'get_device_key_for_verification resolves the device for a valid key_id'
);
select is(
  (select decode(public_key_der, 'base64') from public.get_device_key_for_verification(:'result_key_id'::uuid)),
  '\xaabbcc'::bytea,
  'the public key round-trips through base64 unchanged'
);
select is(
  (select count(*)::integer from public.get_device_key_for_verification('00000000-0000-4000-8000-000000000000'::uuid)),
  0,
  'get_device_key_for_verification returns nothing for an unknown key_id'
);

select ok(
  (select public.check_and_record_device_nonce(:'result_key_id'::uuid, 'nonce-abc-1')),
  'a fresh nonce is accepted'
);
select ok(
  not (select public.check_and_record_device_nonce(:'result_key_id'::uuid, 'nonce-abc-1')),
  'the same nonce is rejected the second time (replay blocked)'
);
select ok(
  (select public.check_and_record_device_nonce(:'result_key_id'::uuid, 'nonce-abc-2')),
  'a different nonce from the same key is still accepted'
);

select public.mint_device_session_token(:'result_key_id'::uuid) as session_token \gset
select ok(length(:'session_token') >= 32, 'mint_device_session_token returns a real opaque token');
select * from public.record_device_heartbeat(:'session_token') \gset hb_
select is(
  :'hb_device_code'::text,
  'TB-M11F-01',
  'the minted session token authenticates an existing, unmodified v1 RPC'
);
select throws_ok(
  format($$select public.record_device_heartbeat(%L)$$, :'session_token'),
  '42501',
  'Invalid or revoked device credential.',
  'the session token is single-use — a second call fails'
);

-- ==================================================================
-- Recovery: local metadata lost, Keystore key still intact.
-- ==================================================================

select throws_ok(
  $$select public.start_device_key_recovery('unknown-fingerprint')$$,
  '42501',
  'Unknown or revoked device key.',
  'recovery rejects an unknown fingerprint'
);

select * from public.start_device_key_recovery('fp-test-1') \gset recovery_
select ok(:'recovery_recovery_attempt_id'::uuid is not null, 'recovery start returns an attempt id');

select * from public.get_device_key_recovery_challenge(:'recovery_recovery_attempt_id'::uuid) \gset rc_
select is(
  decode(:'rc_public_key_der', 'base64'),
  '\xaabbcc'::bytea,
  'the recovery challenge carries the same public key on file'
);

select * from public.complete_device_key_recovery(:'recovery_recovery_attempt_id'::uuid) \gset recovered_
select is(:'recovered_device_id'::text, 'd1000000-0000-4000-8000-000000000020', 'recovery resolves the correct device');
select is(:'recovered_key_id'::text, :'result_key_id'::text, 'recovery resolves the same key_id as the original enrollment');

select throws_ok(
  $$select public.complete_device_key_recovery('00000000-0000-4000-8000-000000000000')$$,
  '42501',
  'Recovery attempt not found or expired.',
  'completing an unknown recovery attempt fails'
);

-- ==================================================================
-- Revocation and admin view
-- ==================================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select is(
  (select has_active_key from public.device_key_admin_view
   where device_id = 'd1000000-0000-4000-8000-000000000020'),
  true,
  'the admin view reports an active key'
);
select lives_ok(
  $$select public.revoke_device_key('d1000000-0000-4000-8000-000000000020')$$,
  'operations can revoke a device key'
);
reset role;

select is(
  (select count(*)::integer from public.device_key_credentials
   where device_id = 'd1000000-0000-4000-8000-000000000020' and revoked_at is null),
  0,
  'no active key credential remains after revocation'
);
select throws_ok(
  format($$select public.mint_device_session_token(%L)$$, :'result_key_id'),
  '42501',
  'Unknown or revoked device key.',
  'a revoked key can no longer mint a session token'
);

select * from finish();
rollback;
