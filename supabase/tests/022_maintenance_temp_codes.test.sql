begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('22000000-0000-4000-8000-000000000001', 'super22@example.test', '{}', now(), now()),
  ('22000000-0000-4000-8000-000000000002', 'ops22@example.test', '{}', now(), now());
update public.profiles set role = 'super_admin' where id = '22000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations' where id = '22000000-0000-4000-8000-000000000002';

insert into public.devices (id, device_code, status) values
  ('22000000-0000-4000-8000-000000000010', 'TB-M13-02', 'provisioning');
insert into public.devices (id, device_code, status) values
  ('22000000-0000-4000-8000-000000000011', 'TB-M13-03', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('22000000-0000-4000-8000-000000000010', encode(digest('DEVM1302', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1302', '22000000-0000-4000-8000-000000000020') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.generate_device_maintenance_temp_code('22000000-0000-4000-8000-000000000010', 'test')$$,
  '42501',
  'Only super_admin can generate a temporary maintenance code.',
  'operations cannot generate a temporary maintenance code'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);

select public.generate_device_maintenance_temp_code(
  '22000000-0000-4000-8000-000000000010', 'technician on-site, PIN forgotten'
) as code \gset

select is(length(:'code'), 6, 'the generated code is exactly 6 digits long');
select is(
  (select count(*)::integer from public.device_maintenance_temp_codes
   where device_id = '22000000-0000-4000-8000-000000000010'),
  1,
  'a row is stored for the generated code'
);
select is(
  (select count(*)::integer from public.audit_events
   where entity_id = '22000000-0000-4000-8000-000000000010'
     and action = 'generate_maintenance_temp_code'),
  1,
  'generating a temp code is audited'
);

reset role;

-- Device-facing verification (what device-verify-maintenance-code calls).
select is(
  public.verify_device_maintenance_temp_code(:'tok', :'code'),
  true,
  'the correct, unexpired, unused code verifies successfully'
);
select is(
  public.verify_device_maintenance_temp_code(:'tok', :'code'),
  false,
  'the same code cannot be used a second time'
);
select is(
  public.verify_device_maintenance_temp_code(:'tok', '000000'),
  false,
  'a wrong code never verifies'
);

-- A code generated for a different device must never verify against
-- this one's token.
set local role authenticated;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select public.generate_device_maintenance_temp_code(
  '22000000-0000-4000-8000-000000000011', 'other device'
) as other_code \gset
reset role;
select is(
  public.verify_device_maintenance_temp_code(:'tok', :'other_code'),
  false,
  'a code generated for a different device is rejected'
);

-- An expired code never verifies (simulated by inserting one already past
-- its expiry, since the RPC itself always sets a real 5-minute TTL).
insert into public.device_maintenance_temp_codes (device_id, code_hash, expires_at) values
  ('22000000-0000-4000-8000-000000000010', crypt('999999', gen_salt('bf', 4)), now() - interval '1 minute');
select is(
  public.verify_device_maintenance_temp_code(:'tok', '999999'),
  false,
  'an expired code never verifies'
);

select * from finish();
rollback;
