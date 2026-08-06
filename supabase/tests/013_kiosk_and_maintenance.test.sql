begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(16);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('d1000000-0000-4000-8000-000000000001', 'super13@example.test', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'ops13@example.test', '{}', now(), now());

update public.profiles set role = 'super_admin' where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations' where id = 'd1000000-0000-4000-8000-000000000002';

insert into public.devices (id, device_code, status) values
  ('d1000000-0000-4000-8000-000000000010', 'TB-M10-01', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('d1000000-0000-4000-8000-000000000010', encode(digest('DEVM1001', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1001', 'd2000000-0000-4000-8000-000000000001') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.set_device_maintenance_pin('d1000000-0000-4000-8000-000000000010', '1234')$$,
  '42501',
  'Only super_admin can set a device maintenance PIN.',
  'operations cannot set a maintenance PIN'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.set_device_maintenance_pin('d1000000-0000-4000-8000-000000000010', '12')$$,
  '22023',
  'PIN must be exactly 6 digits.',
  'a PIN shorter than 6 digits is rejected'
);
select throws_ok(
  $$select public.set_device_maintenance_pin('d1000000-0000-4000-8000-000000000010', 'abcdef')$$,
  '22023',
  'PIN must be exactly 6 digits.',
  'a non-numeric PIN is rejected'
);
select throws_ok(
  $$select public.set_device_maintenance_pin('00000000-0000-4000-8000-000000000000', '123456')$$,
  '22023',
  'Device not found.',
  'a PIN cannot target an unknown device'
);

select lives_ok(
  $$select public.set_device_maintenance_pin('d1000000-0000-4000-8000-000000000010', '135790')$$,
  'super_admin can set a valid 6-digit maintenance PIN'
);
select isnt(
  (select maintenance_pin_hash from public.devices where id = 'd1000000-0000-4000-8000-000000000010'),
  null,
  'the PIN hash is stored'
);
select is(
  (select count(*)::integer from public.devices
   where id = 'd1000000-0000-4000-8000-000000000010'
     and maintenance_pin_hash_version = 2
     and crypt('135790', maintenance_pin_hash) = maintenance_pin_hash),
  1,
  'the stored hash is bcrypt (version 2) and matches the PIN — reproducible offline on the device'
);
select is(
  (select maintenance_pin_salt from public.devices where id = 'd1000000-0000-4000-8000-000000000010'),
  null,
  'a v2 (bcrypt) PIN leaves maintenance_pin_salt unused — bcrypt is self-contained'
);
select is(
  (select count(*)::integer from public.audit_events
   where entity_id = 'd1000000-0000-4000-8000-000000000010'
     and action = 'set_maintenance_pin'
     and actor_role = 'super_admin'),
  1,
  'setting the PIN is audited'
);
select is(
  (select before_snapshot from public.audit_events
   where entity_id = 'd1000000-0000-4000-8000-000000000010'
     and action = 'set_maintenance_pin'),
  null,
  'the audit event never carries the PIN or its hash'
);

reset role;

-- Device-facing: get_device_config now delivers the hash/salt so the
-- tablet can validate a PIN entirely offline.
select is(
  (select maintenance_pin_hash from public.get_device_config(:'tok')),
  (select maintenance_pin_hash from public.devices where id = 'd1000000-0000-4000-8000-000000000010'),
  'get_device_config delivers the current maintenance PIN hash'
);
select is(
  (select maintenance_pin_hash_version from public.get_device_config(:'tok')),
  2,
  'get_device_config delivers the current maintenance PIN hash version'
);

-- Heartbeat: kiosk_level is persisted and constrained to the known set.
select is(
  (select out_device_id from public.record_device_heartbeat(
    :'tok', 90::smallint, 'wifi', 500000000::bigint, '0.4.0-test', now(), null,
    'playing', 5, 'v1', null, null, null,
    null, null, false, null, null, null, null, null,
    'playing', 0, 5, 'lock_task'
  )),
  'd1000000-0000-4000-8000-000000000010',
  'the extended heartbeat call with kiosk_level is accepted'
);
select is(
  (select kiosk_level from public.device_heartbeats
   where device_id = 'd1000000-0000-4000-8000-000000000010' and manifest_version = 'v1'),
  'lock_task',
  'kiosk_level is persisted from the heartbeat call'
);
select throws_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.4.0-test', now(), null,
        'playing', 5, 'v2', null, null, null,
        null, null, false, null, null, null, null, null,
        'playing', 0, 5, 'root_access'
      )$$,
    :'tok'
  ),
  '23514',
  null,
  'an unrecognized kiosk_level value is rejected, never silently accepted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$update public.devices set maintenance_pin_hash = 'forged'
    where id = 'd1000000-0000-4000-8000-000000000010'$$,
  null,
  null,
  'authenticated cannot write maintenance_pin_hash directly; only the RPC can'
);
reset role;

select * from finish();
rollback;
