begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(23);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('c1000000-0000-4000-8000-000000000001', 'ops12@example.test', '{}', now(), now()),
  ('c1000000-0000-4000-8000-000000000002', 'commercial12@example.test', '{}', now(), now());

update public.profiles set role = 'operations' where id = 'c1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'commercial' where id = 'c1000000-0000-4000-8000-000000000002';

insert into public.devices (id, device_code, status) values
  ('c1000000-0000-4000-8000-000000000010', 'TB-M09-01', 'provisioning');

-- Enroll to get a real bearer token, same pattern as the other device-API tests.
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('c1000000-0000-4000-8000-000000000010', encode(digest('DEVM0901', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm0901', 'c2000000-0000-4000-8000-000000000001') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.create_device_command('c1000000-0000-4000-8000-000000000010', 'sync_now')$$,
  '42501',
  'Not authorized to manage fleet records.',
  'commercial cannot queue a device command'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.create_device_command('00000000-0000-4000-8000-000000000000', 'sync_now')$$,
  '22023',
  'Device not found.',
  'a command cannot target an unknown device'
);

select lives_ok(
  $$select public.create_device_command('c1000000-0000-4000-8000-000000000010', 'sync_now')$$,
  'operations can queue a sync_now command'
);
select is(
  (select count(*)::integer from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000010' and status = 'pending'),
  1,
  'the queued command starts pending'
);
select is(
  (select issued_by from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000010'),
  'c1000000-0000-4000-8000-000000000001',
  'the command records who issued it'
);

reset role;

-- Device-facing: fetching pending commands marks them delivered.
select is(
  (select count(*)::integer from public.get_device_pending_commands(:'tok')),
  1,
  'the device fetches exactly the one pending command'
);
select is(
  (select status::text from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000010'),
  'delivered',
  'fetching a pending command marks it delivered'
);
select is(
  (select count(*)::integer from public.get_device_pending_commands(:'tok')),
  1,
  'a delivered (not yet acknowledged) command is still returned on the next poll'
);

select command_id as cmd_id from public.get_device_pending_commands(:'tok') limit 1 \gset

select lives_ok(
  format(
    $$select public.acknowledge_device_command(%L, %L, 'completed', 'ok')$$,
    :'tok', :'cmd_id'
  ),
  'the device acknowledges the command as completed'
);
select is(
  (select status::text from public.device_commands where id = :'cmd_id'),
  'completed',
  'the command is now completed'
);
select is(
  (select count(*)::integer from public.get_device_pending_commands(:'tok')),
  0,
  'a completed command is never delivered again'
);

select throws_ok(
  format(
    $$select public.acknowledge_device_command(%L, %L, 'pending', null)$$,
    :'tok', :'cmd_id'
  ),
  '22023',
  'status must be completed or failed.',
  'a device cannot acknowledge a command back to pending'
);

select throws_ok(
  $$select public.acknowledge_device_command(
      'not-a-real-token-not-a-real-token-x', '00000000-0000-4000-8000-000000000000',
      'completed', null
    )$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token cannot acknowledge a command'
);

-- An expired pending command is never delivered and moves to 'expired'.
update public.device_commands
set expires_at = now() - interval '1 minute'
where device_id = 'c1000000-0000-4000-8000-000000000010' and status = 'completed';
insert into public.device_commands (device_id, command_type, expires_at) values
  ('c1000000-0000-4000-8000-000000000010', 'restart_player', now() - interval '1 minute');

select is(
  (select count(*)::integer from public.get_device_pending_commands(:'tok')),
  0,
  'an already-expired pending command is never delivered'
);
select is(
  (select status::text from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000010' and command_type = 'restart_player'),
  'expired',
  'the expired command is marked expired, not left pending forever'
);

-- Extended heartbeat: operational_status / pending_event_count / clock_skew_seconds.
select is(
  (select out_device_id from public.record_device_heartbeat(
    :'tok', 80::smallint, 'wifi', 500000000::bigint, '0.3.0-test', now(), null,
    'playing', 5, 'v1', null, null, null,
    null, null, false, null, null, null, null, null,
    'syncing', 3, 12
  )),
  'c1000000-0000-4000-8000-000000000010',
  'the extended heartbeat call with sync-status fields is accepted'
);
select is(
  (select operational_status from public.device_heartbeats
   where device_id = 'c1000000-0000-4000-8000-000000000010' and pending_event_count = 3),
  'syncing',
  'operational_status is persisted from the heartbeat call'
);
select is(
  (select clock_skew_seconds from public.device_heartbeats
   where device_id = 'c1000000-0000-4000-8000-000000000010' and pending_event_count = 3),
  12,
  'clock_skew_seconds is persisted from the heartbeat call'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.device_commands (device_id, command_type)
    values ('c1000000-0000-4000-8000-000000000010', 'sync_now')$$,
  null,
  null,
  'authenticated cannot insert device_commands directly; only the RPCs can'
);
reset role;

-- MAX-011 Bloco 8: queuing the same not-yet-finished command again must
-- never duplicate the row — this is exactly what publishCampaignAndSync
-- does every time a campaign is (re)published, fanned out to every device.
-- A dedicated device fixture keeps this from disturbing the row-count
-- assumptions the earlier assertions in this file already rely on.
insert into public.devices (id, device_code, status) values
  ('c1000000-0000-4000-8000-000000000020', 'TB-M09-02', 'provisioning');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

select public.create_device_command('c1000000-0000-4000-8000-000000000020', 'sync_now') as cmd_id_first \gset

select is(
  (select public.create_device_command('c1000000-0000-4000-8000-000000000020', 'sync_now')),
  :'cmd_id_first',
  'requeuing the same pending command_type returns the existing id, not a new one'
);
select is(
  (select count(*)::integer from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000020' and command_type = 'sync_now'),
  1,
  'no duplicate row was created for the same device+command_type'
);
select lives_ok(
  $$select public.create_device_command('c1000000-0000-4000-8000-000000000020', 'restart_player')$$,
  'a different command_type for the same device is not deduplicated against it'
);
select is(
  (select count(*)::integer from public.device_commands
   where device_id = 'c1000000-0000-4000-8000-000000000020'),
  2,
  'the device now has exactly one sync_now and one restart_player command'
);
reset role;

select * from finish();
rollback;
