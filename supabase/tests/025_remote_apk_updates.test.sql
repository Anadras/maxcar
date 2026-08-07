begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(13);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('25000000-0000-4000-8000-000000000001', 'super25@example.test', '{}', now(), now()),
  ('25000000-0000-4000-8000-000000000002', 'ops25@example.test', '{}', now(), now());

update public.profiles set role = 'super_admin' where id = '25000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations' where id = '25000000-0000-4000-8000-000000000002';

insert into public.devices (id, device_code, status) values
  ('25000000-0000-4000-8000-000000000010', 'TB-M14-01', 'provisioning');
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('25000000-0000-4000-8000-000000000010', encode(digest('DEVM1401', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1401', '25000000-0000-4000-8000-000000000011') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.publish_apk_release(2, '0.2.0-pilot', 'staging/2.apk', repeat('a', 64), 1000)$$,
  '42501',
  'Only super_admin can publish an APK release.',
  'operations cannot publish an APK release'
);

select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.publish_apk_release(2, '0.2.0-pilot', 'staging/2.apk', 'not-a-hash', 1000)$$,
  '23514',
  null,
  'a malformed sha256 is rejected by the check constraint'
);

select public.publish_apk_release(2, '0.2.0-pilot', 'staging/2.apk', repeat('a', 64), 1000, 'pilot freeze') as release_id \gset
select isnt(:'release_id'::uuid, null, 'super_admin can publish a release, returns its id');

select is(
  (select version_code from public.apk_releases where id = :'release_id'::uuid),
  2,
  'the release row records the version code'
);
select is(
  (select active from public.apk_releases where id = :'release_id'::uuid),
  true,
  'a freshly published release defaults to active'
);

select throws_ok(
  $$select public.publish_apk_release(2, '0.2.0-pilot-dup', 'staging/2b.apk', repeat('b', 64), 1000)$$,
  '23505',
  null,
  'the same version_code cannot be published twice on the same channel'
);

-- get_device_config is service_role-only — step out of the authenticated
-- role used for the publish/deactivate calls above.
reset role;

-- get_device_config surfaces the latest ACTIVE release for the device.
select latest_apk_version_code, latest_apk_sha256 from public.get_device_config(:'tok') \gset config_
select is(:'config_latest_apk_version_code'::integer, 2, 'get_device_config reports the latest active release''s version code');
select is(:'config_latest_apk_sha256', repeat('a', 64), 'get_device_config reports the latest active release''s sha256');

-- A newer release supersedes the older one.
select public.publish_apk_release(3, '0.3.0-pilot', 'staging/3.apk', repeat('c', 64), 2000) as release_id_3 \gset
select latest_apk_version_code from public.get_device_config(:'tok') \gset config2_
select is(:'config2_latest_apk_version_code'::integer, 3, 'a newer release supersedes the older one');

-- Deactivating the latest release falls back to the next active one.
set local role authenticated;
select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$select public.set_apk_release_active(%L, false)$$, :'release_id_3'),
  '42501',
  'Only super_admin can change an APK release''s availability.',
  'operations cannot deactivate a release'
);

select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000001', true);
select public.set_apk_release_active(:'release_id_3'::uuid, false);
select is(
  (select active from public.apk_releases where id = :'release_id_3'::uuid),
  false,
  'set_apk_release_active can deactivate a bad release'
);

reset role;
select latest_apk_version_code from public.get_device_config(:'tok') \gset config3_
select is(
  :'config3_latest_apk_version_code'::integer, 2,
  'deactivating the newest release falls back to the next active one, not null'
);

-- No active release at all: get_device_config reports null, not an error.
-- Queried inline (not via \gset) because \gset *unsets* the variable
-- entirely on a NULL column value rather than binding it to NULL, which
-- would otherwise leave `:'config4_latest_apk_version_code'` unsubstituted
-- and produce a syntax error instead of the assertion actually running.
select public.set_apk_release_active(:'release_id'::uuid, false);
reset role;
select is(
  (select latest_apk_version_code from public.get_device_config(:'tok')),
  null,
  'with no active release at all, get_device_config reports null cleanly'
);

select * from finish();
rollback;
