begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(19);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.advertisers (id, legal_name, trade_name) values
  ('14000000-0000-4000-8000-000000000001', 'MAX-004 A Ltda', 'MAX-004 A'),
  ('14000000-0000-4000-8000-000000000002', 'MAX-004 B Ltda', 'MAX-004 B');

insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location
) values
  (
    '24000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    'Unidade A', 'Rua A', 'Campo Grande', 'MS',
    extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography
  ),
  (
    '24000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000002',
    'Unidade B', 'Rua B', 'Campo Grande', 'MS',
    extensions.st_setsrid(extensions.st_makepoint(-54.7000, -20.5000), 4326)::extensions.geography
  );

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('04000000-0000-4000-8000-000000000001', 'commercial4@example.test', '{}', now(), now()),
  ('04000000-0000-4000-8000-000000000002', 'operations4@example.test', '{}', now(), now()),
  ('04000000-0000-4000-8000-000000000003', 'advertiser4@example.test', '{}', now(), now());

update public.profiles set role = 'commercial'
where id = '04000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations'
where id = '04000000-0000-4000-8000-000000000002';
update public.profiles
set role = 'advertiser', advertiser_id = '14000000-0000-4000-8000-000000000001'
where id = '04000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '04000000-0000-4000-8000-000000000001', true);

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values
  (
    '34000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    'Regular Test', 'regular', 'draft',
    '2026-07-01 00:00:00+00', '2026-12-31 23:59:59+00',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    'Geo Test', 'geo', 'draft',
    '2026-07-01 00:00:00+00', '2026-12-31 23:59:59+00',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  );

select lives_ok(
  $$insert into public.campaigns (
      advertiser_id, name, campaign_type, status, starts_at, ends_at
    ) values (
      '14000000-0000-4000-8000-000000000001',
      'Commercial Regular', 'regular', 'draft', now(), now() + interval '1 day'
    )$$,
  'commercial can create a REGULAR draft'
);

select throws_ok(
  $$update public.campaigns set status = 'active'
    where id = '34000000-0000-4000-8000-000000000001'$$,
  '23514',
  'Campaign is not structurally ready for activation.',
  'campaign without creative cannot activate'
);

select throws_ok(
  $$insert into public.campaign_geofences (
      campaign_id, establishment_id, radius_meters
    ) values (
      '34000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', 500
    )$$,
  '23514',
  'Only GEO campaigns can have geofences.',
  'REGULAR campaign rejects geofence'
);

select throws_ok(
  $$insert into public.campaign_geofences (
      campaign_id, establishment_id, radius_meters
    ) values (
      '34000000-0000-4000-8000-000000000002',
      '24000000-0000-4000-8000-000000000002', 500
    )$$,
  '23514',
  'Campaign and establishment must belong to the same advertiser.',
  'GEO campaign rejects establishment from another advertiser'
);

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum
) values
  (
    '44000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001',
    'Regular Creative', 'image',
    'advertisers/14000000-0000-4000-8000-000000000001/campaigns/34000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000001.jpg',
    10, 1000, repeat('a', 64)
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '34000000-0000-4000-8000-000000000002',
    'GEO Creative', 'image',
    'advertisers/14000000-0000-4000-8000-000000000001/campaigns/34000000-0000-4000-8000-000000000002/44000000-0000-4000-8000-000000000002.jpg',
    10, 1000, repeat('b', 64)
  );

select lives_ok(
  $$update public.campaigns set status = 'active'
    where id = '34000000-0000-4000-8000-000000000001'$$,
  'REGULAR campaign activates with schedule and creative'
);

select throws_ok(
  $$update public.campaigns set status = 'active'
    where id = '34000000-0000-4000-8000-000000000002'$$,
  '23514',
  'Campaign is not structurally ready for activation.',
  'GEO campaign without geofence cannot activate'
);

insert into public.campaign_geofences (
  id, campaign_id, establishment_id, radius_meters
) values (
  '54000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000002',
  '24000000-0000-4000-8000-000000000001',
  1000
);
update public.campaigns set status = 'active'
where id = '34000000-0000-4000-8000-000000000002';

select ok(
  (select eligible from public.simulate_geofence_eligibility(
    '54000000-0000-4000-8000-000000000001', -20.4700, -54.6200,
    '2026-07-28 16:00:00+00', 'America/Campo_Grande'
  )),
  'nearby point is eligible through PostGIS'
);

select ok(
  not (select within_radius from public.simulate_geofence_eligibility(
    '54000000-0000-4000-8000-000000000001', -20.6000, -54.8000,
    '2026-07-28 16:00:00+00', 'America/Campo_Grande'
  )),
  'distant point is outside the radius'
);

select throws_ok(
  $$update public.campaign_geofences set active = false
    where id = '54000000-0000-4000-8000-000000000001'$$,
  '23514',
  'An active campaign cannot lose its required structure.',
  'active GEO cannot lose its only geofence'
);

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at
) values (
  '34000000-0000-4000-8000-000000000003',
  '14000000-0000-4000-8000-000000000001',
  'Geo Target', 'geo', 'draft',
  '2026-07-01 00:00:00+00', '2026-12-31 23:59:59+00'
);

select throws_ok(
  $$update public.campaign_geofences
    set campaign_id = '34000000-0000-4000-8000-000000000003'
    where id = '54000000-0000-4000-8000-000000000001'$$,
  '23514',
  'An active campaign cannot lose its required structure.',
  'moving the last geofence cannot invalidate its active source campaign'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '04000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$insert into public.campaigns (
      advertiser_id, name, campaign_type, status
    ) values (
      '14000000-0000-4000-8000-000000000001',
      'Operations Forbidden', 'regular', 'draft'
    )$$,
  '42501',
  'new row violates row-level security policy for table "campaigns"',
  'operations cannot create campaigns'
);

select ok(
  private.can_access_campaign_media(
    'advertisers/14000000-0000-4000-8000-000000000001/campaigns/34000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000001.jpg',
    false
  ),
  'operations can read an authorized campaign media path'
);
select ok(
  not private.can_access_campaign_media(
    'advertisers/14000000-0000-4000-8000-000000000001/campaigns/34000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000001.jpg',
    true
  ),
  'operations cannot write campaign media'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '04000000-0000-4000-8000-000000000003', true);

select is(
  (select count(*)::integer from public.campaigns),
  4,
  'advertiser reads only own campaigns'
);
select ok(
  not private.can_access_campaign_media(
    'advertisers/14000000-0000-4000-8000-000000000002/campaigns/34000000-0000-4000-8000-000000000001/44000000-0000-4000-8000-000000000001.jpg',
    false
  ),
  'advertiser cannot read another advertiser media path'
);
select throws_ok(
  $$select * from public.simulate_geofence_eligibility(
    '54000000-0000-4000-8000-000000000001', 91, -54.62
  )$$,
  '22023',
  'Latitude must be between -90 and 90.',
  'simulator rejects invalid latitude'
);

reset role;
select is(
  (select public from storage.buckets where id = 'campaign-media'),
  false,
  'campaign-media bucket remains private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'campaign-media'),
  52428800::bigint,
  'campaign-media bucket enforces the 50 MB ceiling'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname in (
       'campaign_media_authenticated_read',
       'campaign_media_commercial_insert'
     )),
  2,
  'private storage policies are installed'
);

select * from finish();
rollback;
