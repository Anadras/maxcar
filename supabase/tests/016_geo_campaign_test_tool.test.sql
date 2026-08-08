begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('f1000000-0000-4000-8000-000000000001', 'super16@example.test', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'ops16@example.test', '{}', now(), now());
update public.profiles set role = 'super_admin' where id = 'f1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations' where id = 'f1000000-0000-4000-8000-000000000002';

insert into public.advertisers (id, legal_name, trade_name) values
  ('f1000000-0000-4000-8000-000000000010', 'MAX-011 Bloco D Ltda', 'MAX-011-D');

insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location, active
) values (
  'f1000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000010',
  'Posto Teste GEO', 'Rua Um, 100', 'Campo Grande', 'MS',
  extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography,
  true
);

insert into public.devices (id, device_code, status) values
  ('f1000000-0000-4000-8000-000000000020', 'TB-M11D-01', 'online'),
  ('f1000000-0000-4000-8000-000000000021', 'TB-M11D-02', 'online');

-- Device 20 reports itself essentially at the establishment; device 21 has
-- never reported a location at all.
insert into public.device_heartbeats (device_id, recorded_at, network_connected, gps_available, location) values
  (
    'f1000000-0000-4000-8000-000000000020', now(), true, true,
    extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography
  );

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days, priority, cooldown_seconds
) values (
  'f1000000-0000-4000-8000-000000000030', 'f1000000-0000-4000-8000-000000000010',
  'Geo Bloco D', 'geo', 'draft',
  now() - interval '1 day', now() + interval '30 days',
  '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 50, 600
);

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, processing_status, processed_storage_path
) values (
  'f1000000-0000-4000-8000-000000000040', 'f1000000-0000-4000-8000-000000000030',
  'Geo Bloco D Creative', 'image',
  'advertisers/f1000000-0000-4000-8000-000000000010/campaigns/f1000000-0000-4000-8000-000000000030/f1000000-0000-4000-8000-000000000040.jpg',
  10, 400000, repeat('a', 64), 'ready',
  'media-processed/f1000000-0000-4000-8000-000000000040/output.jpg'
);

insert into public.geofences (
  id, establishment_id, name, location, radius_meters
) values (
  'f1000000-0000-4000-8000-000000000060', 'f1000000-0000-4000-8000-000000000011',
  'Posto Teste GEO — Geofence',
  extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography,
  150
);
insert into public.campaign_geofences (
  id, campaign_id, geofence_id, active
) values (
  'f1000000-0000-4000-8000-000000000050', 'f1000000-0000-4000-8000-000000000030',
  'f1000000-0000-4000-8000-000000000060', true
);

update public.campaigns set status = 'active' where id = 'f1000000-0000-4000-8000-000000000030';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.test_geo_campaign_delivery(
      'f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000030'
    )$$,
  '42501',
  'Only super_admin can run the GEO test tool.',
  'operations cannot run the GEO simulated test tool, only super_admin'
);

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.test_geo_campaign_delivery(
      'f1000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000000'
    )$$,
  '22023',
  'Campaign not found.',
  'the tool rejects an unknown campaign id'
);
select throws_ok(
  $$select public.test_geo_campaign_delivery(
      '00000000-0000-4000-8000-000000000000', 'f1000000-0000-4000-8000-000000000030'
    )$$,
  '22023',
  'Device not found.',
  'the tool rejects an unknown device id'
);

select is(
  (public.test_geo_campaign_delivery(
    'f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000030'
  ))->>'simulated',
  'true',
  'the result is always explicitly marked as a simulation'
);
select is(
  (public.test_geo_campaign_delivery(
    'f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000030'
  ))->'geofences'->0->>'insideRadius',
  'true',
  'a device whose last known location is at the establishment is reported inside the radius'
);
select is(
  (public.test_geo_campaign_delivery(
    'f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000030'
  ))->>'deviceAllowed',
  'true',
  'an unrestricted campaign allows the device'
);

select is(
  (public.test_geo_campaign_delivery(
    'f1000000-0000-4000-8000-000000000021', 'f1000000-0000-4000-8000-000000000030'
  ))->>'deviceHasKnownLocation',
  'false',
  'a device that never reported a location is flagged as such, distance is never guessed'
);
select is(
  (public.test_geo_campaign_delivery(
    'f1000000-0000-4000-8000-000000000021', 'f1000000-0000-4000-8000-000000000030'
  ))->'geofences'->0->>'insideRadius',
  null,
  'insideRadius is null (never false) when the device has no known location — unknown, not "outside"'
);

select lives_ok(
  $$select public.set_campaign_devices(
      'f1000000-0000-4000-8000-000000000030',
      array['f1000000-0000-4000-8000-000000000021']::uuid[]
    )$$,
  'restrict the campaign to device 21 only, to verify deviceAllowed goes false for device 20'
);
reset role;

select * from finish();
rollback;
