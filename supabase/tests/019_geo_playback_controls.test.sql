begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.advertisers (id, legal_name, trade_name) values
  ('19000000-0000-4000-8000-000000000001', 'MAX-011 Ltda', 'MAX-011');

insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location, active
) values
  (
    '19000000-0000-4000-8000-000000000010', '19000000-0000-4000-8000-000000000001',
    'Posto Playback', 'Rua Um, 100', 'Campo Grande', 'MS',
    extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography,
    true
  );

insert into public.devices (id, device_code, status) values
  ('19000000-0000-4000-8000-000000000020', 'TB-M11-02', 'provisioning');

-- Campaign A leaves playback_mode/max_wait_seconds unset — must backfill
-- to the safe 'after_current'/5 defaults (MAX-011 item 18: never change
-- existing/omitted behavior silently). Campaign B sets both explicitly.
-- Inserted 'draft' (matching 011_geo_rules_and_events.test.sql's own
-- pattern) and only flipped to 'active' below, after their creative and
-- geofence exist — private.validate_campaign_activation() rejects an
-- activation attempt for a campaign that isn't yet structurally ready.
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days, priority, cooldown_seconds
) values
  (
    '19000000-0000-4000-8000-000000000030', '19000000-0000-4000-8000-000000000001',
    'Geo Playback Default', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 5, 900
  );

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days, priority, cooldown_seconds,
  playback_mode, max_wait_seconds
) values
  (
    '19000000-0000-4000-8000-000000000031', '19000000-0000-4000-8000-000000000001',
    'Geo Playback Max Wait', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[], 10, 300,
    'max_wait', 20
  );

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, processing_status, processed_storage_path
) values
  (
    '19000000-0000-4000-8000-000000000040', '19000000-0000-4000-8000-000000000030',
    'Default Playback Creative', 'image',
    'advertisers/19000000-0000-4000-8000-000000000001/campaigns/19000000-0000-4000-8000-000000000030/19000000-0000-4000-8000-000000000040.jpg',
    10, 400000, repeat('a', 64), 'ready',
    'media-processed/19000000-0000-4000-8000-000000000040/output.jpg'
  ),
  (
    '19000000-0000-4000-8000-000000000041', '19000000-0000-4000-8000-000000000031',
    'Max Wait Creative', 'image',
    'advertisers/19000000-0000-4000-8000-000000000001/campaigns/19000000-0000-4000-8000-000000000031/19000000-0000-4000-8000-000000000041.jpg',
    10, 400000, repeat('b', 64), 'ready',
    'media-processed/19000000-0000-4000-8000-000000000041/output.jpg'
  );

-- Geofence A overrides the campaign default to immediate/10s; geofence B
-- (campaign B) has no override, so it must fall through to the campaign's
-- own explicit max_wait/20s.
insert into public.campaign_geofences (
  id, campaign_id, establishment_id, radius_meters,
  playback_mode_override, max_wait_seconds_override, active
) values
  (
    '19000000-0000-4000-8000-000000000050', '19000000-0000-4000-8000-000000000030',
    '19000000-0000-4000-8000-000000000010', 150, 'immediate', 10, true
  ),
  (
    '19000000-0000-4000-8000-000000000051', '19000000-0000-4000-8000-000000000031',
    '19000000-0000-4000-8000-000000000010', 150, null, null, true
  );

update public.campaigns set status = 'active' where id = '19000000-0000-4000-8000-000000000030';
update public.campaigns set status = 'active' where id = '19000000-0000-4000-8000-000000000031';

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('19000000-0000-4000-8000-000000000020', encode(digest('DEVM1102', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm1102', '19000000-0000-4000-8000-000000000060') \gset

create temp view geo_rules_for_playback_test as
  select rule
  from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule;

select is(
  (select rule->>'playbackMode' from geo_rules_for_playback_test
   where rule->>'geofenceId' = '19000000-0000-4000-8000-000000000050'),
  'IMMEDIATE',
  'a geofence playback_mode_override wins over the campaign default'
);
select is(
  (select (rule->>'maxWaitSeconds')::int from geo_rules_for_playback_test
   where rule->>'geofenceId' = '19000000-0000-4000-8000-000000000050'),
  10,
  'a geofence max_wait_seconds_override wins over the campaign default'
);
select is(
  (select rule->>'playbackMode' from geo_rules_for_playback_test
   where rule->>'geofenceId' = '19000000-0000-4000-8000-000000000051'),
  'MAX_WAIT',
  'with no geofence override, the campaign''s own explicit playback_mode is delivered'
);
select is(
  (select (rule->>'maxWaitSeconds')::int from geo_rules_for_playback_test
   where rule->>'geofenceId' = '19000000-0000-4000-8000-000000000051'),
  20,
  'with no geofence override, the campaign''s own explicit max_wait_seconds is delivered'
);

select is(
  (select playback_mode::text from public.campaigns
   where id = '19000000-0000-4000-8000-000000000030'),
  'after_current',
  'a campaign created without an explicit playback_mode backfills to after_current, never a silent behavior change'
);
select is(
  (select max_wait_seconds from public.campaigns
   where id = '19000000-0000-4000-8000-000000000030'),
  5,
  'a campaign created without an explicit max_wait_seconds backfills to the 5s default'
);

select throws_ok(
  $$insert into public.campaigns (
      advertiser_id, name, campaign_type, status, max_wait_seconds
    ) values (
      '19000000-0000-4000-8000-000000000001', 'Bad Wait', 'geo', 'draft', 0
    )$$,
  '23514',
  null,
  'max_wait_seconds outside 1-30 is rejected at the campaign level'
);
select throws_ok(
  $$update public.campaign_geofences
    set max_wait_seconds_override = 31
    where id = '19000000-0000-4000-8000-000000000050'$$,
  '23514',
  null,
  'max_wait_seconds_override outside 1-30 is rejected at the geofence level'
);

-- Panel visibility: campaign_admin_view/campaign_geofence_admin_view must
-- actually surface the new columns (a `select c.*`-in-a-view regression
-- would otherwise silently hide them from the admin panel and its
-- generated TypeScript types without breaking anything at the SQL level).
select is(
  (select playback_mode::text from public.campaign_admin_view
   where id = '19000000-0000-4000-8000-000000000031'),
  'max_wait',
  'campaign_admin_view exposes playback_mode'
);
select is(
  (select campaign_playback_mode::text from public.campaign_geofence_admin_view
   where id = '19000000-0000-4000-8000-000000000051'),
  'max_wait',
  'campaign_geofence_admin_view exposes the resolved campaign default alongside any override'
);

select * from finish();
rollback;
