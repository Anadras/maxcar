begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Update the seed's stray unowned default playlist out of the way, same
-- pattern as 009_media_manifest_and_playback_events.test.sql.
update public.playlists set active = false where device_id is null;

insert into public.advertisers (id, legal_name, trade_name) values
  ('24000000-0000-4000-8000-000000000001', 'MAX-013 Manifest Ltda', 'MAX-013 Manifest');

insert into public.devices (id, device_code, status) values
  ('24000000-0000-4000-8000-000000000020', 'TB-M24-01', 'provisioning');

insert into public.establishments (
  id, advertiser_id, name, address_line, city, state, location, active
) values (
  '24000000-0000-4000-8000-000000000010', '24000000-0000-4000-8000-000000000001',
  'Posto Processado', 'Rua Um, 100', 'Campo Grande', 'MS',
  extensions.st_setsrid(extensions.st_makepoint(-54.6167, -20.4489), 4326)::extensions.geography,
  true
);

-- One REGULAR campaign whose sole creative has a processed derivative, and
-- one GEO campaign whose sole creative is still legacy (no processed_*
-- columns populated) — covering both delivery paths in one file.
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values
  (
    '24000000-0000-4000-8000-000000000030', '24000000-0000-4000-8000-000000000001',
    'Regular Processed', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '24000000-0000-4000-8000-000000000031', '24000000-0000-4000-8000-000000000001',
    'Geo Legacy', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  );

insert into public.campaign_geofences (id, campaign_id, establishment_id, radius_meters) values
  ('24000000-0000-4000-8000-000000000060', '24000000-0000-4000-8000-000000000031', '24000000-0000-4000-8000-000000000010', 100);

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum,
  processing_status, processed_storage_path, processed_sha256, processed_size_bytes
) values (
  '24000000-0000-4000-8000-000000000040', '24000000-0000-4000-8000-000000000030',
  'Regular Processed Creative', 'video',
  'advertisers/24000000-0000-4000-8000-000000000001/campaigns/24000000-0000-4000-8000-000000000030/original.mp4',
  15, 2000000, repeat('a', 64),
  'ready', 'media-processed/24000000-0000-4000-8000-000000000040/output.mp4', repeat('9', 64), 1800000
);

-- Legacy row: pre-pipeline, defaults to ready with no processed_* set.
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum
) values (
  '24000000-0000-4000-8000-000000000041', '24000000-0000-4000-8000-000000000031',
  'Geo Legacy Creative', 'image',
  'advertisers/24000000-0000-4000-8000-000000000001/campaigns/24000000-0000-4000-8000-000000000031/legacy.jpg',
  10, 400000, repeat('b', 64)
);

-- Both campaigns only become structurally ready once their creative (and,
-- for the geo one, its geofence) exists — activate last, same order as
-- 009_media_manifest_and_playback_events.test.sql.
update public.campaigns set status = 'active' where id = '24000000-0000-4000-8000-000000000030';
update public.campaigns set status = 'active' where id = '24000000-0000-4000-8000-000000000031';

insert into public.playlists (id, name, device_id) values
  ('24000000-0000-4000-8000-000000000050', 'Grade do TB-M24-01', '24000000-0000-4000-8000-000000000020');
insert into public.playlist_items (playlist_id, campaign_id, position) values
  ('24000000-0000-4000-8000-000000000050', '24000000-0000-4000-8000-000000000030', 1);

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('24000000-0000-4000-8000-000000000020', encode(digest('DEVM2401', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok from public.enroll_device('devm2401', '24000000-0000-4000-8000-000000000021') \gset

-- REGULAR: the processed derivative is what ships, never the original.
select is(
  (select ((public.get_device_manifest(:'tok'))->'playlist'->0->>'storagePath')),
  'media-processed/24000000-0000-4000-8000-000000000040/output.mp4',
  'manifest storagePath is the processed derivative, not the original upload'
);
select is(
  (select ((public.get_device_manifest(:'tok'))->'playlist'->0->>'sha256')),
  repeat('9', 64),
  'manifest sha256 is the processed hash, not the original checksum'
);
select is(
  (select ((public.get_device_manifest(:'tok'))->'playlist'->0->>'fileSizeBytes')::bigint),
  1800000::bigint,
  'manifest fileSizeBytes prefers processed_size_bytes when present'
);

-- The seed data may already ship other active GEO campaigns/geofences, so
-- every geo-rules assertion below filters down to this file's own
-- geofence id rather than assuming it's the only row returned.

-- GEO: a legacy creative (no processed_* populated) falls back to the
-- original — this is the LEGACY_READY continuity path, no separate flag.
select is(
  (select rule->>'storagePath'
   from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '24000000-0000-4000-8000-000000000060'),
  'advertisers/24000000-0000-4000-8000-000000000001/campaigns/24000000-0000-4000-8000-000000000031/legacy.jpg',
  'geo rules fall back to the original storage path for a pre-pipeline (legacy) creative'
);
select is(
  (select rule->>'sha256'
   from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '24000000-0000-4000-8000-000000000060'),
  repeat('b', 64),
  'geo rules fall back to the original checksum for a pre-pipeline (legacy) creative'
);

-- The lateral join picks its candidate by "order by created_at limit 1"
-- among rows matching the WHERE clause — so to prove the readiness filter
-- itself does real exclusion work (not just incidental insert order), add
-- a SECOND, OLDER, not-yet-ready creative to the same active campaign.
-- Without the readiness filter, "order by created_at limit 1" would pick
-- this older-but-unready row instead of the genuinely ready one.
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, created_at,
  processing_status, processed_storage_path
) values (
  '24000000-0000-4000-8000-000000000042', '24000000-0000-4000-8000-000000000030',
  'Regular Older Not-Ready Creative', 'video',
  'advertisers/24000000-0000-4000-8000-000000000001/campaigns/24000000-0000-4000-8000-000000000030/older-unready.mp4',
  15, 2000000, repeat('c', 64), now() - interval '1 hour',
  'processing', null
);

select is(
  (select ((public.get_device_manifest(:'tok'))->'playlist'->0->>'creativeId')),
  '24000000-0000-4000-8000-000000000040',
  'the manifest still picks the ready creative over an older but not-yet-ready one'
);

-- Same proof on the GEO side: add a second, older, not-ready creative to
-- the geo campaign alongside its legacy (ready) one.
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, created_at,
  processing_status, processed_storage_path
) values (
  '24000000-0000-4000-8000-000000000043', '24000000-0000-4000-8000-000000000031',
  'Geo Older Not-Ready Creative', 'image',
  'advertisers/24000000-0000-4000-8000-000000000001/campaigns/24000000-0000-4000-8000-000000000031/older-unready.jpg',
  10, 400000, repeat('d', 64), now() - interval '1 hour',
  'processing', null
);

select is(
  (select rule->>'creativeId'
   from jsonb_array_elements((public.get_device_geo_rules(:'tok'))->'rules') as rule
   where rule->>'geofenceId' = '24000000-0000-4000-8000-000000000060'),
  '24000000-0000-4000-8000-000000000041',
  'geo rules still pick the ready creative over an older but not-yet-ready one'
);

-- A live campaign mid-reprocessing (its ready creative flipped back to
-- 'processing' by the pipeline — e.g. a re-upload was just queued — but
-- still holding its last-known-good processed_storage_path from the
-- prior run) keeps serving that last-known-good derivative, and the
-- active-campaign-invalidation trigger doesn't reject the update. See the
-- comment on private.campaign_is_structurally_ready for why this matters:
-- without it, the pipeline's own claim_next_media_processing_job could
-- never re-process a live campaign's creative at all.
select lives_ok(
  $$update public.campaign_creatives set processing_status = 'processing'
    where id = '24000000-0000-4000-8000-000000000040'$$,
  'reprocessing a live campaign''s already-ready creative is not rejected by the active-campaign trigger'
);

select is(
  (select ((public.get_device_manifest(:'tok'))->'playlist'->0->>'storagePath')),
  'media-processed/24000000-0000-4000-8000-000000000040/output.mp4',
  'a live campaign mid-reprocessing keeps serving its last-known-good derivative, not dropped from rotation'
);

select * from finish();
rollback;
