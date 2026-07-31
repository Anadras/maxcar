begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(14);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.devices (id, device_code, status) values
  ('70000000-0000-4000-8000-000000000001', 'TB-ENR01', 'provisioning');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('70000000-0000-4000-8000-000000000002', 'ops7@example.test', '{}', now(), now()),
  ('70000000-0000-4000-8000-000000000003', 'commercial7@example.test', '{}', now(), now());
update public.profiles set role = 'operations', active = true
where id = '70000000-0000-4000-8000-000000000002';
update public.profiles set role = 'commercial', active = true
where id = '70000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.generate_device_enrollment_code('70000000-0000-4000-8000-000000000001')$$,
  '42501',
  'Not authorized to generate enrollment codes.',
  'commercial cannot generate an enrollment code'
);

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select ok(
  (select count(*) from public.generate_device_enrollment_code('70000000-0000-4000-8000-000000000001')) = 1,
  'operations generates an enrollment code'
);
reset role;
select is(
  (select count(*)::integer from public.device_enrollment_codes where device_id = '70000000-0000-4000-8000-000000000001'),
  1,
  'exactly one enrollment code row exists'
);

-- Generating a second code revokes the first (unique partial index would
-- otherwise reject a second unused/unrevoked row for the same device).
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select ok(
  (select count(*) from public.generate_device_enrollment_code('70000000-0000-4000-8000-000000000001')) = 1,
  'a second enrollment code can be generated'
);
reset role;
select is(
  (select count(*)::integer from public.device_enrollment_codes
   where device_id = '70000000-0000-4000-8000-000000000001' and revoked_at is null and used_at is null),
  1,
  'only one usable code remains after regenerating'
);
select is(
  (select count(*)::integer from public.device_enrollment_codes
   where device_id = '70000000-0000-4000-8000-000000000001' and revoked_at is not null),
  1,
  'the previous code was revoked'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.revoke_device_enrollment_code('70000000-0000-4000-8000-000000000001')$$,
  'operations can revoke the pending enrollment code'
);
reset role;
select is(
  (select count(*)::integer from public.device_enrollment_codes
   where device_id = '70000000-0000-4000-8000-000000000001' and revoked_at is null and used_at is null),
  0,
  'no usable code remains after revocation'
);

-- device_credentials and device_enrollment_codes: never exposed to
-- authenticated/anon over PostgREST, only through the SECURITY DEFINER
-- functions above and the admin view below.
set local role authenticated;
select throws_ok(
  $$select count(*) from public.device_enrollment_codes$$,
  '42501',
  null,
  'device_enrollment_codes is not selectable by authenticated'
);
select throws_ok(
  $$select count(*) from public.device_credentials$$,
  '42501',
  null,
  'device_credentials is not selectable by authenticated'
);
reset role;

-- Credential + enrollment view invariants (as postgres, bypassing RLS on
-- the base tables to seed test fixtures directly).
insert into public.device_credentials (device_id, token_hash, installation_id)
values (
  '70000000-0000-4000-8000-000000000001',
  encode(extensions.digest('test-token-one', 'sha256'), 'hex'),
  gen_random_uuid()
);
select throws_ok(
  $$insert into public.device_credentials (device_id, token_hash)
    values ('70000000-0000-4000-8000-000000000001', encode(extensions.digest('test-token-two', 'sha256'), 'hex'))$$,
  '23505',
  null,
  'a device cannot receive two simultaneously active credentials'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select is(
  (select is_enrolled from public.device_enrollment_admin_view where device_id = '70000000-0000-4000-8000-000000000001'),
  true,
  'the admin view reports the device as enrolled'
);
reset role;

update public.device_credentials
set revoked_at = now()
where device_id = '70000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select is(
  (select is_enrolled from public.device_enrollment_admin_view where device_id = '70000000-0000-4000-8000-000000000001'),
  false,
  'the admin view reports the device as not enrolled once its credential is revoked'
);
select lives_ok(
  $$select public.revoke_device_credential('70000000-0000-4000-8000-000000000001')$$,
  'revoking an already-revoked credential is a harmless no-op'
);
reset role;

select * from finish();
rollback;
