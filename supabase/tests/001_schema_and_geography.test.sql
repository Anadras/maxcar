begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(29);

select has_extension('postgis', 'PostGIS is enabled');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'advertisers', 'advertisers exists');
select has_table('public', 'establishments', 'establishments exists');
select has_table('public', 'drivers', 'drivers exists');
select has_table('public', 'vehicles', 'vehicles exists');
select has_table('public', 'devices', 'devices exists');
select has_table('public', 'campaigns', 'campaigns exists');
select has_table('public', 'campaign_creatives', 'campaign_creatives exists');
select has_table('public', 'campaign_geofences', 'campaign_geofences exists');
select has_table('public', 'geofences', 'geofences exists');
select has_table('public', 'playlists', 'playlists exists');
select has_table('public', 'playlist_items', 'playlist_items exists');
select has_table('public', 'geofence_events', 'geofence_events exists');
select has_table('public', 'impressions', 'impressions exists');
select has_table('public', 'device_heartbeats', 'device_heartbeats exists');
select has_table('public', 'driver_sessions', 'driver_sessions exists');

select has_index(
  'public',
  'establishments',
  'establishments_location_gist_idx',
  'establishments has a spatial GIST index'
);
select has_index(
  'public',
  'impressions',
  'impressions_idempotency_unique',
  'impressions has an idempotency index'
);
select has_index(
  'public',
  'device_heartbeats',
  'device_heartbeats_device_recorded_at_idx',
  'heartbeats have a device/time index'
);

select is(
  (
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'establishments'
      and column_name = 'location'
  ),
  'geography',
  'establishment location uses geography'
);

select throws_ok(
  $$
    insert into public.geofences (
      establishment_id, name, location, radius_meters
    ) values (
      '30000000-0000-4000-8000-000000000002',
      'Test',
      extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography,
      -1
    )
  $$,
  '23514',
  null,
  'negative radius is rejected'
);

select throws_ok(
  $$
    insert into public.impressions (
      device_id, campaign_id, source, status, started_at,
      completion_percentage, client_event_id
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'regular',
      'completed',
      now(),
      101,
      'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'completion above 100 is rejected'
);

select throws_ok(
  $$
    insert into public.device_heartbeats (
      device_id, recorded_at, battery_level, network_connected, gps_available
    ) values (
      '50000000-0000-4000-8000-000000000001',
      now(),
      -1,
      true,
      true
    )
  $$,
  '23514',
  null,
  'negative battery level is rejected'
);

select throws_ok(
  $$
    insert into public.impressions (
      device_id, campaign_id, source, status, started_at,
      completion_percentage, client_event_id
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'regular',
      'completed',
      now(),
      100,
      'b1000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  null,
  'replayed client event is rejected for the same device'
);

select ok(
  extensions.st_dwithin(
    extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(-54.6112, -20.4584), 4326)::extensions.geography,
    2000
  ),
  'PostGIS identifies two nearby development points within 2 km'
);

select ok(
  not extensions.st_dwithin(
    extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(-54.6112, -20.4584), 4326)::extensions.geography,
    50
  ),
  'PostGIS rejects the same points for a 50 m radius'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'advertisers', 'establishments', 'drivers', 'vehicles',
        'devices', 'campaigns', 'campaign_creatives', 'campaign_geofences',
        'geofences', 'playlists', 'playlist_items', 'geofence_events',
        'impressions', 'device_heartbeats', 'driver_sessions'
      )
      and c.relrowsecurity
  ),
  16,
  'RLS is enabled on all application tables'
);

select has_function(
  'public',
  'set_updated_at',
  array[]::text[],
  'updated_at trigger helper exists'
);

select * from finish();
rollback;
