begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.devices (id, device_code, status) values
  ('28000000-0000-4000-8000-000000000010', 'TB-M19-01', 'provisioning');

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('28000000-0000-4000-8000-000000000010', encode(digest('DEVM1901', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1901', '28000000-0000-4000-8000-000000000020') \gset

-- MAX-019: the four new kiosk_level states plus the kiosk_reason detail
-- that only ever accompanies device_owner_unlocked.
select is(
  (select out_device_id from public.record_device_heartbeat(
    :'tok', 90::smallint, 'wifi', 500000000::bigint, '0.5.0-test', now(), null,
    'playing_confirmed', 5, 'v1', null, null, null,
    null, null, false, null, null, null, null, null,
    'playing', 0, 5, 'device_owner_locked', 0, null
  )),
  '28000000-0000-4000-8000-000000000010',
  'a heartbeat reporting device_owner_locked is accepted'
);

select lives_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.5.0-test', now(), null,
        'no_ready_media', 0, 'v2', null, null, null,
        null, null, false, null, null, null, null, null,
        'no_content', 0, 5, 'device_owner_unlocked', 0, 'lock_task_not_engaged'
      )$$,
    :'tok'
  ),
  'device_owner_unlocked with a kiosk_reason is accepted'
);
select is(
  (select kiosk_level from public.device_heartbeats
   where device_id = '28000000-0000-4000-8000-000000000010' and manifest_version = 'v2'),
  'device_owner_unlocked',
  'kiosk_level is persisted'
);
select is(
  (select kiosk_reason from public.device_heartbeats
   where device_id = '28000000-0000-4000-8000-000000000010' and manifest_version = 'v2'),
  'lock_task_not_engaged',
  'kiosk_reason is persisted alongside it'
);

select throws_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.5.0-test', now(), null,
        'no_ready_media', 0, 'v3', null, null, null,
        null, null, false, null, null, null, null, null,
        'no_content', 0, 5, 'device_owner_unlocked', 0, 'battery_low'
      )$$,
    :'tok'
  ),
  '23514',
  null,
  'an unrecognized kiosk_reason value is rejected, never silently accepted'
);

-- Backward compatibility: the pre-MAX-019 bare "device_owner" value must
-- keep working — an in-flight build that hasn't updated yet, or a row
-- already stored, is never invalidated by this migration.
select lives_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.4.0-test', now(), null,
        'playing_confirmed', 5, 'v4', null, null, null,
        null, null, false, null, null, null, null, null,
        'playing', 0, 5, 'device_owner'
      )$$,
    :'tok'
  ),
  'the pre-MAX-019 bare device_owner kiosk_level value is still accepted'
);

-- devices.last_confirmed_frame_at: only ever advances on a
-- playing_confirmed report, and is left untouched by every other report —
-- the whole point is that it survives however long the tablet spends
-- away from playing_confirmed afterward (MAX-019: "tempo sem reprodução").
select is(
  (select last_confirmed_frame_at is not null from public.devices
   where id = '28000000-0000-4000-8000-000000000010'),
  true,
  'last_confirmed_frame_at was set by the earlier playing_confirmed heartbeat'
);

select last_confirmed_frame_at as frame_before from public.devices
where id = '28000000-0000-4000-8000-000000000010' \gset

select public.record_device_heartbeat(
  :'tok', 90::smallint, 'wifi', 500000000::bigint, '0.5.0-test', now(), null,
  'no_ready_media', 0, 'v5', null, null, null,
  null, null, false, null, null, null, null, null,
  'no_content', 0, 5, 'no_content_mode', 0, null
);
select is(
  (select last_confirmed_frame_at from public.devices
   where id = '28000000-0000-4000-8000-000000000010'),
  :'frame_before'::timestamptz,
  'a subsequent non-playing heartbeat leaves last_confirmed_frame_at unchanged'
);

select throws_ok(
  format(
    $$select public.record_device_heartbeat(
        %L, 90::smallint, 'wifi', 500000000::bigint, '0.5.0-test', now(), null,
        'no_ready_media', 0, 'v6', null, null, null,
        null, null, false, null, null, null, null, null,
        'no_content', 0, 5, 'root_access'
      )$$,
    :'tok'
  ),
  '23514',
  null,
  'an unrecognized kiosk_level value is still rejected after the MAX-019 vocabulary expansion'
);

select * from finish();
rollback;
