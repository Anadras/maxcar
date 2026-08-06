begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(4);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.devices (id, device_code, status) values
  ('20000000-0000-4000-8000-000000000010', 'TB-M12-01', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('20000000-0000-4000-8000-000000000010', encode(digest('DEVM1201', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1201', '20000000-0000-4000-8000-000000000020') \gset

-- MAX-012: the heartbeat's new quarantined_media_count field — same
-- additive-optional shape as every other player-telemetry column added
-- since MAX-007, and it must actually land in device_heartbeats for the
-- panel to ever show it.
select is(
  (select out_device_id from public.record_device_heartbeat(
    :'tok', 90::smallint, 'wifi', 500000000::bigint, '0.4.0-test', now(), null,
    'stalled', 5, 'v1', null, null, null,
    null, null, false, null, null, null, null, null,
    'recovering', 0, 5, 'lock_task', 2
  )),
  '20000000-0000-4000-8000-000000000010',
  'a heartbeat with quarantined_media_count is accepted'
);
select is(
  (select quarantined_media_count from public.device_heartbeats
   where device_id = '20000000-0000-4000-8000-000000000010'
   order by recorded_at desc limit 1),
  2,
  'quarantined_media_count is persisted on the heartbeat row'
);

-- A heartbeat that omits it entirely (the shape every pre-MAX-012 test
-- and app build still sends) must keep working unchanged.
select lives_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.4.0-test', now(), null,
        'playing_confirmed', 5, 'v2', null, null, null,
        null, null, false, null, null, null, null, null,
        'playing', 0, 5, 'lock_task'
      )$$,
    :'tok'
  ),
  'a heartbeat that omits quarantined_media_count still succeeds'
);

select throws_ok(
  $$insert into public.device_heartbeats
      (device_id, recorded_at, network_connected, gps_available, quarantined_media_count)
    values ('20000000-0000-4000-8000-000000000010', now(), true, false, -1)$$,
  '23514',
  null,
  'a negative quarantined_media_count is rejected at the table level'
);

select * from finish();
rollback;
