begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.devices (id, device_code, status) values
  ('81000000-0000-4000-8000-000000000001', 'TB-API01', 'provisioning');
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('81000000-0000-4000-8000-000000000001', encode(digest('GOODCODE', 'sha256'), 'hex'), now() + interval '15 minutes');

select throws_ok(
  $$select * from public.enroll_device('WRONGCODE', '11000000-0000-4000-8000-000000000001')$$,
  '42501',
  'Enrollment code is invalid, expired or already used.',
  'a wrong code is rejected'
);
-- A RAISE rolls back everything done inside enroll_device itself, so
-- attempt logging is the caller's own follow-up call, exercised here the
-- same way the Edge Function would.
select public.record_device_enrollment_attempt('11000000-0000-4000-8000-000000000001', false);
select is(
  (select count(*)::integer from public.device_enrollment_attempts
   where installation_id = '11000000-0000-4000-8000-000000000001' and succeeded = false),
  1,
  'the failed attempt is logged for throttling'
);

select is(
  (select count(*) from public.enroll_device('goodcode', '11000000-0000-4000-8000-000000000002'))::integer,
  1,
  'a correct code (case-insensitive) enrolls the device'
);
select is(
  (select used_at is not null from public.device_enrollment_codes
   where device_id = '81000000-0000-4000-8000-000000000001'),
  true,
  'the code is marked used'
);
select throws_ok(
  $$select * from public.enroll_device('goodcode', '11000000-0000-4000-8000-000000000003')$$,
  '42501',
  'Enrollment code is invalid, expired or already used.',
  'the same code cannot be used twice'
);

select is(
  (select count(*)::integer from public.device_credentials
   where device_id = '81000000-0000-4000-8000-000000000001' and revoked_at is null),
  1,
  'exactly one active credential exists after enrollment'
);

-- A fresh device/credential pair whose raw token we keep in a psql
-- variable (enroll_device only ever returns the raw token once, by
-- design, so the earlier enrollment's token is intentionally unrecoverable
-- here) to exercise heartbeat + config + revocation end to end.
insert into public.devices (id, device_code, status) values
  ('81000000-0000-4000-8000-000000000002', 'TB-API02', 'provisioning');
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('81000000-0000-4000-8000-000000000002', encode(digest('SECOND01', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('second01', '11000000-0000-4000-8000-000000000004') \gset

select is(
  (select count(*)::integer from public.record_device_heartbeat(
    :'tok', 88::smallint, 'wifi', 5000000000::bigint, '1.0.0-test',
    now(), '22000000-0000-4000-8000-000000000001'::uuid
  )),
  1,
  'heartbeat is recorded with a valid token'
);
select is(
  (select count(*)::integer from public.device_heartbeats
   where device_id = '81000000-0000-4000-8000-000000000002'),
  1,
  'exactly one heartbeat row was written'
);

-- Retry with the same client_event_id must not create a second row.
select public.record_device_heartbeat(
  :'tok', 10::smallint, 'cellular', 1000000000::bigint, '1.0.0-test',
  now(), '22000000-0000-4000-8000-000000000001'::uuid
);
select is(
  (select count(*)::integer from public.device_heartbeats
   where device_id = '81000000-0000-4000-8000-000000000002'),
  1,
  'a retried client_event_id does not duplicate the heartbeat'
);
select is(
  (select battery_level from public.device_heartbeats
   where device_id = '81000000-0000-4000-8000-000000000002'),
  88::smallint,
  'the original heartbeat values are preserved, not the retried ones'
);

select is(
  (select heartbeat_interval_seconds from public.get_device_config(:'tok')),
  900,
  'device config returns the server-controlled defaults'
);

select throws_ok(
  $$select * from public.record_device_heartbeat('not-a-real-token-not-a-real-token-x', 50::smallint)$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token is rejected'
);

update public.device_credentials set revoked_at = now()
where device_id = '81000000-0000-4000-8000-000000000002';
select throws_ok(
  format($$select * from public.record_device_heartbeat(%L, 50::smallint)$$, :'tok'),
  '42501',
  'Invalid or revoked device credential.',
  'a revoked token is rejected'
);

select is(
  (select count(*)::integer from public.device_enrollment_attempts
   where installation_id = '11000000-0000-4000-8000-000000000005'),
  0,
  'sanity: unrelated installation ids have no attempt history'
);

select * from finish();
rollback;
