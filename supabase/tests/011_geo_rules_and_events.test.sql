begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.advertisers (id, legal_name, trade_name) values
  ('b1000000-0000-4000-8000-000000000001', 'MAX-008 Ltda', 'MAX-008');

insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location, active
) values
  (
    'b1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000001',
    'Posto Ready', 'Rua Um, 100', 'Campo Grande', 'MS',
    extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography,
    true
  ),
  (
    'b1000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000001',
    'Posto Inativo', 'Rua Dois, 200', 'Campo Grande', 'MS',
    extensions.st_setsrid(extensions.st_makepoint(-54.60, -20.44), 4326)::extensions.geography,
    false
  );

insert into public.devices (id, device_code, status) values
  ('b1000000-0000-4000-8000-000000000020', 'TB-M08-01', 'provisioning');

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days, priority, cooldown_seconds
) values
  (
    'b1000000-0000-4000-8000-000000000030', 'b1000000-0000-4000-8000-000000000001',
    'Geo Ready', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 40, 600
  ),
  (
    'b1000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000001',
    'Geo Not Ready (no geofence yet)', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 50, 300
  ),
  (
    'b1000000-0000-4000-8000-000000000032', 'b1000000-0000-4000-8000-000000000001',
    'Geo At Inactive Establishment', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 50, 300
  ),
  (
    'b1000000-0000-4000-8000-000000000033', 'b1000000-0000-4000-8000-000000000001',
    'Regular Control', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 50, 0
  );

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum
) values
  (
    'b1000000-0000-4000-8000-000000000040', 'b1000000-0000-4000-8000-000000000030',
    'Geo Ready Creative', 'image',
    'advertisers/b1000000-0000-4000-8000-000000000001/campaigns/b1000000-0000-4000-8000-000000000030/b1000000-0000-4000-8000-000000000040.jpg',
    10, 400000, repeat('d', 64)
  ),
  (
    'b1000000-0000-4000-8000-000000000042', 'b1000000-0000-4000-8000-000000000032',
    'Geo Inactive Establishment Creative', 'image',
    'advertisers/b1000000-0000-4000-8000-000000000001/campaigns/b1000000-0000-4000-8000-000000000032/b1000000-0000-4000-8000-000000000042.jpg',
    10, 400000, repeat('e', 64)
  ),
  (
    'b1000000-0000-4000-8000-000000000043', 'b1000000-0000-4000-8000-000000000033',
    'Regular Control Creative', 'image',
    'advertisers/b1000000-0000-4000-8000-000000000001/campaigns/b1000000-0000-4000-8000-000000000033/b1000000-0000-4000-8000-000000000043.jpg',
    10, 400000, repeat('f', 64)
  );

insert into public.campaign_geofences (
  id, campaign_id, establishment_id, radius_meters, priority_override, cooldown_override_seconds, active
) values
  (
    'b1000000-0000-4000-8000-000000000050', 'b1000000-0000-4000-8000-000000000030',
    'b1000000-0000-4000-8000-000000000010', 150, 90, 900, true
  ),
  (
    'b1000000-0000-4000-8000-000000000052', 'b1000000-0000-4000-8000-000000000032',
    'b1000000-0000-4000-8000-000000000011', 150, null, null, true
  );

select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'b1000000-0000-4000-8000-000000000030'$$,
  'the ready GEO campaign activates'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'b1000000-0000-4000-8000-000000000032'$$,
  'the inactive-establishment GEO campaign still activates (establishment.active is a delivery filter, not a readiness rule)'
);

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('b1000000-0000-4000-8000-000000000020', encode(digest('DEVM0801', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm0801', 'b2000000-0000-4000-8000-000000000001') \gset

-- Other seed/dev-environment GEO campaigns may also be structurally ready
-- and would legitimately appear in the same delivery, so assertions target
-- this file's own fixture row by id rather than the array as a whole.
create temp view geo_rules_for_test as
  select rule
  from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule;

select is(
  (select count(*)::integer from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000050'),
  1,
  'the structurally-ready GEO rule at an active establishment is delivered exactly once'
);
select is(
  (select count(*)::integer from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000052'),
  0,
  'a GEO rule at an inactive establishment is never delivered'
);
select is(
  (select rule->>'creativeId' from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000050'),
  'b1000000-0000-4000-8000-000000000040',
  'the delivered rule carries the GEO campaign''s active creative'
);
select is(
  (select (rule->>'priority')::int from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000050'),
  90,
  'a geofence priority_override wins over the campaign default priority'
);
select is(
  (select (rule->>'cooldownSeconds')::int from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000050'),
  900,
  'a geofence cooldown_override_seconds wins over the campaign default cooldown'
);
select is(
  (select round(((rule->>'latitude')::numeric), 4) from geo_rules_for_test
   where rule->>'geofenceId' = 'b1000000-0000-4000-8000-000000000050'),
  -20.4489,
  'the delivered latitude matches the establishment location'
);
select is(
  (select ((public.get_device_geo_rules(:'tok'))->>'deviceId')),
  'b1000000-0000-4000-8000-000000000020',
  'the rules header reports the device id derived from the token, not a client-supplied one'
);

select throws_ok(
  $$select public.get_device_geo_rules('not-a-real-token-not-a-real-token-x')$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token cannot fetch GEO rules'
);

-- Geofence transition events: idempotent, one row per state-machine transition.
select is(
  (select recorded from public.record_device_geofence_event(
    :'tok', 'b1000000-0000-4000-8000-000000000050', 'enter',
    -20.4489, -54.6167, 12.5, 40.0, now(), 'b3000000-0000-4000-8000-000000000001'::uuid
  )),
  true,
  'an enter event is recorded'
);
select is(
  (select count(*)::integer from public.geofence_events
   where device_id = 'b1000000-0000-4000-8000-000000000020'
     and client_event_id = 'b3000000-0000-4000-8000-000000000001'),
  1,
  'exactly one geofence_events row exists for the event'
);
select is(
  (select recorded from public.record_device_geofence_event(
    :'tok', 'b1000000-0000-4000-8000-000000000050', 'enter',
    -20.4489, -54.6167, 12.5, 40.0, now(), 'b3000000-0000-4000-8000-000000000001'::uuid
  )),
  false,
  'retrying the same client_event_id is a no-op, not a duplicate'
);
select throws_ok(
  $$select public.record_device_geofence_event(
      'not-a-real-token-not-a-real-token-x', 'b1000000-0000-4000-8000-000000000050', 'exit',
      -20.4489, -54.6167, 12.5, 40.0, now(), 'b3000000-0000-4000-8000-000000000002'::uuid
    )$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token cannot log a geofence event'
);
select throws_ok(
  format(
    $$select public.record_device_geofence_event(
        %L, '00000000-0000-4000-8000-000000000000', 'exit',
        -20.4489, -54.6167, 12.5, 40.0, now(), 'b3000000-0000-4000-8000-000000000003'::uuid
      )$$,
    :'tok'
  ),
  '22023',
  'geofenceId does not reference a known geofence.',
  'an unknown geofence id is rejected'
);
select throws_ok(
  format(
    $$select public.record_device_geofence_event(
        %L, 'b1000000-0000-4000-8000-000000000050', 'exit',
        200.0, -54.6167, 12.5, 40.0, now(), 'b3000000-0000-4000-8000-000000000004'::uuid
      )$$,
    :'tok'
  ),
  '22023',
  'Latitude must be between -90 and 90.',
  'an out-of-range latitude is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$insert into public.geofence_events (device_id, campaign_geofence_id, event_type, occurred_at, location)
    values (
      'b1000000-0000-4000-8000-000000000020', 'b1000000-0000-4000-8000-000000000050', 'enter', now(),
      extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography
    )$$,
  null,
  null,
  'authenticated cannot insert geofence_events directly; only the service-role RPC can'
);
reset role;

select * from finish();
rollback;
