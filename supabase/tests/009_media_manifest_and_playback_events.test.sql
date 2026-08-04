begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The development seed already ships one playlist with no device_id, which
-- is now, by construction, the pilot's global default grade. Deactivate it
-- here so this file's own fixtures own that slot instead; harmless, since
-- the whole file rolls back.
update public.playlists set active = false where device_id is null;

insert into public.advertisers (id, legal_name, trade_name) values
  ('91000000-0000-4000-8000-000000000001', 'MAX-007 Ltda', 'MAX-007');

insert into public.devices (id, device_code, status) values
  ('91000000-0000-4000-8000-000000000001', 'TB-M07-01', 'provisioning'),
  ('91000000-0000-4000-8000-000000000002', 'TB-M07-02', 'provisioning');

-- A ready, active REGULAR campaign: the only kind the manifest should ever include.
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Regular Ready', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'Regular For Default Grade', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    'Regular Not Ready (draft, no dates)', 'regular', 'draft',
    null, null, null, null, array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '92000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000001',
    'Geo Campaign', 'geo', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  );

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum
) values
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Ready Creative', 'video',
    'advertisers/91000000-0000-4000-8000-000000000001/campaigns/92000000-0000-4000-8000-000000000001/93000000-0000-4000-8000-000000000001.mp4',
    15, 2000000, repeat('a', 64)
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'Default Grade Creative', 'image',
    'advertisers/91000000-0000-4000-8000-000000000001/campaigns/92000000-0000-4000-8000-000000000002/93000000-0000-4000-8000-000000000002.jpg',
    10, 500000, repeat('b', 64)
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000004',
    'Geo Creative', 'image',
    'advertisers/91000000-0000-4000-8000-000000000001/campaigns/92000000-0000-4000-8000-000000000004/93000000-0000-4000-8000-000000000003.jpg',
    10, 500000, repeat('c', 64)
  );

select lives_ok(
  $$update public.campaigns set status = 'active' where id = '92000000-0000-4000-8000-000000000001'$$,
  'the ready REGULAR campaign activates'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = '92000000-0000-4000-8000-000000000002'$$,
  'the default-grade REGULAR campaign activates'
);

-- Device-specific playlist for device 1; the pilot global default for device 2.
insert into public.playlists (id, name, device_id) values
  ('94000000-0000-4000-8000-000000000001', 'Grade do TB-M07-01', '91000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002', 'Grade padrão do piloto', null);

insert into public.playlist_items (playlist_id, campaign_id, position) values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 1),
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000003', 2),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 1);

select throws_ok(
  $$insert into public.playlist_items (playlist_id, campaign_id, position)
    values ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000004', 2)$$,
  '23514',
  'Only REGULAR campaigns can be added to a playlist.',
  'a GEO campaign cannot be added to a playlist'
);

select throws_ok(
  $$insert into public.playlists (name, device_id)
    values ('Segunda grade do mesmo device', '91000000-0000-4000-8000-000000000001')$$,
  '23505',
  null,
  'a device cannot have two active playlists at once'
);
select throws_ok(
  $$insert into public.playlists (name, device_id) values ('Segunda grade padrão', null)$$,
  '23505',
  null,
  'only one active global default playlist can exist'
);

-- Enroll both devices to get real bearer tokens, exactly like the Edge
-- Function's device-enroll would.
insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('91000000-0000-4000-8000-000000000001', encode(digest('DEVONE01', 'sha256'), 'hex'), now() + interval '15 minutes'),
  ('91000000-0000-4000-8000-000000000002', encode(digest('DEVTWO01', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok1 from public.enroll_device('devone01', '95000000-0000-4000-8000-000000000001') \gset
select device_token as tok2 from public.enroll_device('devtwo01', '95000000-0000-4000-8000-000000000002') \gset

select is(
  (select (public.get_device_manifest(:'tok1'))->>'deviceId'),
  '91000000-0000-4000-8000-000000000001',
  'the manifest reports the device id derived from the token, not a client-supplied one'
);
select is(
  (select jsonb_array_length((public.get_device_manifest(:'tok1'))->'playlist')),
  1,
  'the device-specific playlist only includes the ready campaign, not the not-ready one'
);
select is(
  (select ((public.get_device_manifest(:'tok1'))->'playlist'->0->>'creativeId')),
  '93000000-0000-4000-8000-000000000001',
  'the manifest item matches the ready campaign''s active creative'
);
select is(
  (select ((public.get_device_manifest(:'tok1'))->'playlist'->0->>'mimeType')),
  'video/mp4',
  'the mime type is derived from the storage path extension'
);

select is(
  (select jsonb_array_length((public.get_device_manifest(:'tok2'))->'playlist')),
  1,
  'a device without its own playlist falls back to the global default grade'
);
select is(
  (select ((public.get_device_manifest(:'tok2'))->'playlist'->0->>'creativeId')),
  '93000000-0000-4000-8000-000000000002',
  'the fallback manifest item comes from the default grade, not the other device''s playlist'
);

select throws_ok(
  $$select public.get_device_manifest('not-a-real-token-not-a-real-token-x')$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token cannot fetch a manifest'
);

-- Playback events: one finalized row per attempt, idempotent by client_event_id.
select is(
  (select recorded from public.record_device_playback_event(
    :'tok1', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
    'completed', now() - interval '15 seconds', now(), 15000, 100,
    null, false, '96000000-0000-4000-8000-000000000001'::uuid
  )),
  true,
  'a completed playback event is recorded'
);
select is(
  (select count(*)::integer from public.impressions
   where device_id = '91000000-0000-4000-8000-000000000001'
     and client_event_id = '96000000-0000-4000-8000-000000000001'),
  1,
  'exactly one impression row exists for the event'
);
select is(
  (select recorded from public.record_device_playback_event(
    :'tok1', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
    'completed', now(), now(), 999, 50,
    null, false, '96000000-0000-4000-8000-000000000001'::uuid
  )),
  false,
  'retrying the same client_event_id is a no-op, not a duplicate'
);
select is(
  (select duration_ms from public.impressions
   where client_event_id = '96000000-0000-4000-8000-000000000001'),
  15000,
  'the original event data is preserved, not the retried values'
);

select is(
  (select recorded from public.record_device_playback_event(
    :'tok1', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
    'failed', now(), now(), 2000, 20,
    'decode_error', false, '96000000-0000-4000-8000-000000000002'::uuid
  )),
  true,
  'a failed playback event records its failure reason'
);
select is(
  (select failure_reason from public.impressions
   where client_event_id = '96000000-0000-4000-8000-000000000002'),
  'decode_error',
  'the failure reason is persisted for diagnostics'
);

select throws_ok(
  format(
    $$select public.record_device_playback_event(
        %L, '92000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000003',
        'completed', now(), now(), 5000, 100, null, false,
        '96000000-0000-4000-8000-000000000003'::uuid
      )$$,
    :'tok1'
  ),
  '22023',
  'campaignId must reference a REGULAR campaign.',
  'a GEO campaign cannot be logged as a playback event'
);

select throws_ok(
  $$select public.record_device_playback_event(
      'not-a-real-token-not-a-real-token-x', '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001', 'completed', now(), now(), 1000, 100,
      null, false, '96000000-0000-4000-8000-000000000004'::uuid
    )$$,
  '42501',
  'Invalid or revoked device credential.',
  'a bogus token cannot log a playback event'
);

-- record_device_heartbeat must keep working for callers that only pass the
-- original MAX-006 parameter set (regression test for the overload
-- ambiguity a wider signature would otherwise introduce).
select is(
  (select count(*)::integer from public.record_device_heartbeat(:'tok2', 42::smallint)),
  1,
  'the original (MAX-006) heartbeat call shape still resolves to a single function'
);
select is(
  (select count(*)::integer from public.record_device_heartbeat(
    :'tok2', 42::smallint, 'wifi', 1000000000::bigint, '0.2.0-test', now(), null,
    'playing', 3, 'abc123', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002',
    null
  )),
  1,
  'the extended heartbeat call records player-state fields'
);
-- Both heartbeat calls above ran inside this same transaction, so now()
-- (transaction_timestamp) ties between them; filter by the extended call's
-- own manifest_version instead of ordering by recorded_at.
select is(
  (select player_state from public.device_heartbeats
   where device_id = '91000000-0000-4000-8000-000000000002'
     and manifest_version = 'abc123'),
  'playing',
  'the player state from the extended heartbeat call is persisted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$insert into public.impressions (
      device_id, campaign_id, source, status, started_at, client_event_id
    ) values (
      '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
      'regular', 'completed', now(), '96000000-0000-4000-8000-000000000099'
    )$$,
  null,
  null,
  'authenticated cannot insert impressions directly; only the service-role RPC can'
);
reset role;

select * from finish();
rollback;
