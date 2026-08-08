begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(25);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('29000000-0000-4000-8000-000000000001', 'commercial29@example.test', '{}', now(), now());
update public.profiles set role = 'commercial' where id = '29000000-0000-4000-8000-000000000001';

insert into public.advertisers (id, legal_name, trade_name) values
  ('29000000-0000-4000-8000-000000000010', 'MAX-020 Ltda', 'MAX-020');

-- One establishment, multiple geofences ("vários pontos de exibição") —
-- the core new capability.
insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location
) values (
  '29000000-0000-4000-8000-000000000020', '29000000-0000-4000-8000-000000000010',
  'Shopping MAX-020', 'Avenida Central, 1000', 'Campo Grande', 'MS',
  extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);

select (public.save_geofence(
  null, '29000000-0000-4000-8000-000000000020', 'Entrada principal',
  -20.4697, -54.6201, 500, true
)).id as entrance_id \gset
select (public.save_geofence(
  null, '29000000-0000-4000-8000-000000000020', 'Estacionamento',
  -20.4710, -54.6220, 300, true
)).id as parking_id \gset

select is(
  (select count(*)::integer from public.geofences where establishment_id = '29000000-0000-4000-8000-000000000020'),
  2,
  'one establishment now owns two independently-located geofences'
);
select is(
  (select radius_meters from public.geofences where id = :'entrance_id'::uuid),
  500,
  'each geofence keeps its own radius'
);
select isnt(
  (select radius_meters from public.geofences where id = :'entrance_id'::uuid),
  (select radius_meters from public.geofences where id = :'parking_id'::uuid),
  'different geofences on the same establishment can have different radii'
);

select lives_ok(
  $$select public.save_geofence(
      null, '29000000-0000-4000-8000-000000000020', 'Drive-thru',
      -20.4690, -54.6190, 150, true
    )$$,
  'save_geofence supports a third geofence on the same establishment without conflict'
);
select is(
  (select count(*)::integer from public.geofences where establishment_id = '29000000-0000-4000-8000-000000000020'),
  3,
  'the establishment now has three geofences'
);

reset role;

-- A GEO campaign linking to MULTIPLE geofences ("uma campanha GEO pode
-- possuir uma ou várias geofences").
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values (
  '29000000-0000-4000-8000-000000000030', '29000000-0000-4000-8000-000000000010',
  'Multi-local', 'geo', 'draft',
  now() - interval '1 day', now() + interval '30 days',
  '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
);
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, processing_status, processed_storage_path
) values (
  '29000000-0000-4000-8000-000000000040', '29000000-0000-4000-8000-000000000030',
  'Multi-local Creative', 'image',
  'advertisers/29000000-0000-4000-8000-000000000010/campaigns/29000000-0000-4000-8000-000000000030/29000000-0000-4000-8000-000000000040.jpg',
  10, 400000, repeat('a', 64), 'ready',
  'media-processed/29000000-0000-4000-8000-000000000040/output.jpg'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    $$insert into public.campaign_geofences (id, campaign_id, geofence_id) values
      ('29000000-0000-4000-8000-000000000050', '29000000-0000-4000-8000-000000000030', %L),
      ('29000000-0000-4000-8000-000000000051', '29000000-0000-4000-8000-000000000030', %L)$$,
    :'entrance_id', :'parking_id'
  ),
  'a single GEO campaign links to two distinct geofences (N:N)'
);
select throws_ok(
  format(
    $$insert into public.campaign_geofences (campaign_id, geofence_id) values
      ('29000000-0000-4000-8000-000000000030', %L)$$,
    :'entrance_id'
  ),
  '23505',
  null,
  'the same campaign cannot link to the same geofence twice'
);

reset role;

update public.campaigns set status = 'active' where id = '29000000-0000-4000-8000-000000000030';

insert into public.devices (id, device_code, status) values
  ('29000000-0000-4000-8000-000000000060', 'TB-M20-01', 'provisioning');
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('29000000-0000-4000-8000-000000000060', encode(digest('DEVM2001', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm2001', '29000000-0000-4000-8000-000000000070') \gset

create temp view geo_rules_29 as
  select rule from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule;

select is(
  (select count(*)::integer from geo_rules_29
   where rule->>'geofenceId' in ('29000000-0000-4000-8000-000000000050', '29000000-0000-4000-8000-000000000051')),
  2,
  'get_device_geo_rules delivers both geofence links for the multi-location campaign'
);
select is(
  (select rule->>'establishmentId' from geo_rules_29
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000050'),
  '29000000-0000-4000-8000-000000000020',
  'each delivered rule still resolves back to the shared establishment'
);
select is(
  (select round(((rule->>'latitude')::numeric), 4) from geo_rules_29
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000050'),
  -20.4697,
  'the entrance rule carries the entrance geofence''s own point, not the establishment''s bare location'
);
select is(
  (select round(((rule->>'latitude')::numeric), 4) from geo_rules_29
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000051'),
  -20.4710,
  'the parking rule carries a genuinely different point from the same establishment'
);

-- Deactivating ONE of two geofence links leaves the campaign structurally
-- ready (the other link still satisfies it) and removes only that one
-- rule from delivery — never touches the still-active link's own rule.
select lives_ok(
  $$update public.campaign_geofences set active = false
    where id = '29000000-0000-4000-8000-000000000051'$$,
  'deactivating one of two geofence links on an active campaign is allowed — the other link still satisfies structural readiness'
);
select is(
  (select count(*)::integer from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000051'),
  0,
  'the deactivated link''s rule is no longer delivered'
);
select is(
  (select count(*)::integer from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000050'),
  1,
  'the still-active link''s rule keeps being delivered unaffected'
);

-- Deactivating the geofence itself (not the campaign_geofences link) has
-- the same delivery effect, independent of cg.active.
select lives_ok(
  format(
    $$select public.save_geofence(%L::uuid, '29000000-0000-4000-8000-000000000020', 'Entrada principal', -20.4697, -54.6201, 500, false)$$,
    :'entrance_id'
  ),
  'deactivating the geofence place itself succeeds'
);
select is(
  (select count(*)::integer from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '29000000-0000-4000-8000-000000000050'),
  0,
  'once the underlying geofence place is inactive, its rule stops being delivered even though the campaign link itself is still active'
);

-- Now BOTH links are effectively inactive for delivery purposes (one via
-- cg.active=false, one via g.active=false) — the campaign itself must
-- lose structural readiness the same way "active campaign can't lose its
-- last geofence" already worked pre-migration, since campaign_is_
-- structurally_ready only checks cg.active (unchanged, pre-existing
-- semantics — see the migration's own comment on this).
select throws_ok(
  $$update public.campaign_geofences set active = false
    where id = '29000000-0000-4000-8000-000000000050'$$,
  '23514',
  'An active campaign cannot lose its required structure.',
  'the last cg.active=true link on an active campaign still cannot be removed — unchanged pre-migration guarantee'
);

-- Legacy compatibility: the pre-migration single-geofence shape (already
-- exercised by every other GEO test file in this suite, whose seed and
-- backfill both went through this exact migration) still works
-- end-to-end through the same get_device_geo_rules/simulate_geofence_
-- eligibility/test_geo_campaign_delivery path — spot-check one more time
-- here with a fresh, deliberately single-geofence campaign to make the
-- "legado" claim explicit and self-contained in this file.
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values (
  '29000000-0000-4000-8000-000000000031', '29000000-0000-4000-8000-000000000010',
  'Single Legacy Shape', 'geo', 'draft',
  now() - interval '1 day', now() + interval '30 days',
  '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
);
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, processing_status, processed_storage_path
) values (
  '29000000-0000-4000-8000-000000000041', '29000000-0000-4000-8000-000000000031',
  'Single Legacy Creative', 'image',
  'advertisers/29000000-0000-4000-8000-000000000010/campaigns/29000000-0000-4000-8000-000000000031/29000000-0000-4000-8000-000000000041.jpg',
  10, 400000, repeat('b', 64), 'ready',
  'media-processed/29000000-0000-4000-8000-000000000041/output.jpg'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    $$insert into public.campaign_geofences (campaign_id, geofence_id) values ('29000000-0000-4000-8000-000000000031', %L)$$,
    :'parking_id'
  ),
  'a campaign with exactly one geofence link — the shape every pre-MAX-020 campaign has — still inserts cleanly'
);
reset role;
select lives_ok(
  $$update public.campaigns set status = 'active' where id = '29000000-0000-4000-8000-000000000031'$$,
  'a single-geofence GEO campaign activates exactly as it did before this migration'
);

-- geofence_admin_view and campaign_geofence_admin_view surface the new
-- shape correctly.
select is(
  (select campaign_link_count from public.geofence_admin_view where id = :'parking_id'::uuid),
  2,
  'geofence_admin_view counts campaign links across campaigns sharing one geofence'
);
select is(
  (select geofence_name from public.campaign_geofence_admin_view where id = '29000000-0000-4000-8000-000000000050'),
  'Entrada principal',
  'campaign_geofence_admin_view exposes the geofence''s own name'
);
select is(
  (select geofence_active from public.campaign_geofence_admin_view where id = '29000000-0000-4000-8000-000000000050'),
  false,
  'campaign_geofence_admin_view distinguishes the geofence''s own active flag from the link''s'
);
select is(
  (select establishment_name from public.campaign_geofence_admin_view where id = '29000000-0000-4000-8000-000000000050'),
  'Shopping MAX-020',
  'campaign_geofence_admin_view still resolves the establishment name through the new join'
);

-- simulate_geofence_eligibility and test_geo_campaign_delivery both work
-- through the new schema too (super_admin needed for the latter).
select ok(
  (select within_radius from public.simulate_geofence_eligibility(
    '29000000-0000-4000-8000-000000000051', -20.4710, -54.6220,
    now(), 'America/Campo_Grande'
  )),
  'simulate_geofence_eligibility resolves distance/radius through the new geofences table'
);

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('29000000-0000-4000-8000-000000000002', 'super29@example.test', '{}', now(), now());
update public.profiles set role = 'super_admin' where id = '29000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000002', true);
select is(
  jsonb_array_length((public.test_geo_campaign_delivery(
    '29000000-0000-4000-8000-000000000060', '29000000-0000-4000-8000-000000000030'
  ))->'geofences'),
  2,
  'test_geo_campaign_delivery reports both geofence links for the multi-location campaign'
);
reset role;

select * from finish();
rollback;
