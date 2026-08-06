begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(15);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('18000000-0000-4000-8000-000000000001', 'ops18@example.test', '{}', now(), now()),
  ('18000000-0000-4000-8000-000000000002', 'commercial18@example.test', '{}', now(), now());

update public.profiles set role = 'operations' where id = '18000000-0000-4000-8000-000000000001';
update public.profiles set role = 'commercial' where id = '18000000-0000-4000-8000-000000000002';

insert into public.devices (id, device_code, status) values
  ('18000000-0000-4000-8000-000000000010', 'TB-M11-01', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('18000000-0000-4000-8000-000000000010', encode(digest('DEVM1101', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1101', '18000000-0000-4000-8000-000000000020') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);

-- set_device_maintenance_timeout: same require_fleet_manager() bar as
-- create_device_command — deliberately looser than the PIN's
-- super_admin-only check (MAX-011: a duration is operational tuning, not a
-- security secret the PIN is).
select throws_ok(
  $$select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', 300)$$,
  '42501',
  'Not authorized to manage fleet records.',
  'commercial cannot set a device maintenance timeout'
);

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', 30)$$,
  '22023',
  'Timeout must be between 60 and 1800 seconds.',
  'a timeout below 60s is rejected'
);
select throws_ok(
  $$select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', 3600)$$,
  '22023',
  'Timeout must be between 60 and 1800 seconds.',
  'a timeout above 1800s is rejected'
);
select throws_ok(
  $$select public.set_device_maintenance_timeout('00000000-0000-4000-8000-000000000000', 300)$$,
  '22023',
  'Device not found.',
  'a timeout cannot target an unknown device'
);

select lives_ok(
  $$select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', 600)$$,
  'operations can set a valid maintenance timeout'
);
select is(
  (select maintenance_timeout_seconds from public.devices
   where id = '18000000-0000-4000-8000-000000000010'),
  600,
  'the timeout is stored'
);

-- audit_events only has a super_admin SELECT policy (same as every other
-- audited action in this codebase) — operations, who is authorized to
-- *set* the timeout, still can't read the audit trail back; reset to a
-- superuser role just for this one check, same escape hatch the RLS
-- test file itself uses.
reset role;
select is(
  (select count(*)::integer from public.audit_events
   where entity_id = '18000000-0000-4000-8000-000000000010'
     and action = 'set_maintenance_timeout'
     and actor_role = 'operations'),
  1,
  'setting the timeout is audited'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', null)$$,
  'passing null clears the per-device override'
);
select is(
  (select maintenance_timeout_seconds from public.devices
   where id = '18000000-0000-4000-8000-000000000010'),
  null,
  'the override is cleared back to null (device falls back to the app default)'
);

-- Re-set a value so the device-facing assertion below has something
-- non-default to actually verify round-tripped.
select public.set_device_maintenance_timeout('18000000-0000-4000-8000-000000000010', 900);

-- The three new kiosk command verbs (MAX-011) are just new
-- device_command_type enum values — create_device_command,
-- get_device_pending_commands and acknowledge_device_command are already
-- fully generic over command_type, so this only needs to confirm the enum
-- accepts them end to end, same as any existing command type.
select lives_ok(
  $$select public.create_device_command('18000000-0000-4000-8000-000000000010', 'disable_kiosk_temporarily')$$,
  'operations can queue a disable_kiosk_temporarily command'
);
select lives_ok(
  $$select public.create_device_command('18000000-0000-4000-8000-000000000010', 'reenter_kiosk')$$,
  'operations can queue a reenter_kiosk command'
);
select lives_ok(
  $$select public.create_device_command('18000000-0000-4000-8000-000000000010', 'enable_kiosk')$$,
  'operations can queue an enable_kiosk command'
);
select is(
  (select count(*)::integer from public.device_commands
   where device_id = '18000000-0000-4000-8000-000000000010' and status = 'pending'),
  3,
  'all three kiosk commands are queued pending'
);

reset role;

-- Device-facing round trip: fetching pending commands delivers the new
-- verbs like any other, and get_device_config now carries the timeout.
select is(
  (select count(*)::integer from public.get_device_pending_commands(:'tok')),
  3,
  'the device fetches all three pending kiosk commands'
);
select is(
  (select maintenance_timeout_seconds from public.get_device_config(:'tok')),
  900,
  'get_device_config delivers the current per-device maintenance timeout'
);

select * from finish();
rollback;
