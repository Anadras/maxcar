begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(18);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('27000000-0000-4000-8000-000000000001', 'commercial27@example.test', '{}', now(), now());
update public.profiles set role = 'commercial' where id = '27000000-0000-4000-8000-000000000001';

insert into public.advertisers (id, legal_name, trade_name) values
  ('27000000-0000-4000-8000-000000000010', 'MAX-017 Ltda', 'MAX-017');
insert into public.campaigns (id, advertiser_id, name, campaign_type, status) values
  ('27000000-0000-4000-8000-000000000020', '27000000-0000-4000-8000-000000000010', 'Campaign M17', 'regular', 'draft');

-- ==================================================================
-- 1. The safe default itself.
-- ==================================================================
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum) values (
  '27000000-0000-4000-8000-000000000030', '27000000-0000-4000-8000-000000000020', 'Default Check', 'video',
  'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/default-check.mp4',
  10, repeat('a', 64)
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000030'),
  'uploaded',
  'the column default is uploaded, not ready'
);

-- ==================================================================
-- 2. The INSERT trigger: reject ready without a processed derivative,
--    even when explicitly requested — this is the exact shape the
--    TESTE01 incident (reg03/regular04) slipped through as.
-- ==================================================================
select throws_ok(
  $$insert into public.campaign_creatives (
      id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum, processing_status
    ) values (
      '27000000-0000-4000-8000-000000000031', '27000000-0000-4000-8000-000000000020', 'Unearned Ready', 'video',
      'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/unearned.mp4',
      10, repeat('b', 64), 'ready'
    )$$,
  '23514',
  null,
  'inserting a new creative as ready without processed_storage_path is rejected'
);
select is(
  (select count(*)::integer from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000031'),
  0,
  'the rejected insert left no row behind'
);

-- A row that legitimately earns ready+processed_storage_path together
-- (mirroring what report_media_processing_result writes, even though
-- that path is normally an UPDATE) is not blocked by the trigger.
select lives_ok(
  $$insert into public.campaign_creatives (
      id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum,
      processing_status, processed_storage_path
    ) values (
      '27000000-0000-4000-8000-000000000032', '27000000-0000-4000-8000-000000000020', 'Earned Ready', 'video',
      'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/earned.mp4',
      10, repeat('c', 64), 'ready', 'media-processed/x/earned.mp4'
    )$$,
  'inserting ready WITH a processed_storage_path is allowed'
);

-- Backward compatibility: the trigger only fires on INSERT, so an UPDATE
-- to an already-existing legacy row (ready, no processed derivative —
-- exactly what the one-time 20260822090000 backfill produced) is
-- untouched, e.g. toggling `active`. A legacy row can't be simulated via
-- a fresh INSERT anymore (the trigger correctly won't let a brand new
-- row claim to be old) — so it's built the only honest way left: insert
-- normally, then UPDATE straight to the legacy shape, which is exactly
-- what the trigger is supposed to allow.
insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum, active
) values (
  '27000000-0000-4000-8000-000000000033', '27000000-0000-4000-8000-000000000020', 'Legacy Row', 'video',
  'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/legacy.mp4',
  10, repeat('d', 64), true
);
update public.campaign_creatives
set processing_status = 'ready'
where id = '27000000-0000-4000-8000-000000000033';
select throws_ok(
  $$insert into public.campaign_creatives (
      id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum, processing_status
    ) values (
      '27000000-0000-4000-8000-000000000034', '27000000-0000-4000-8000-000000000020', 'Not Really Legacy', 'video',
      'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/not-legacy.mp4',
      10, repeat('e', 64), 'ready'
    )$$,
  '23514',
  null,
  'a fresh insert cannot claim to be legacy either — the guarantee only ever applied to rows that already existed'
);
select lives_ok(
  $$update public.campaign_creatives set active = false where id = '27000000-0000-4000-8000-000000000033'$$,
  'updating an existing legacy ready row (e.g. toggling active) is never blocked by the INSERT-only trigger'
);

-- ==================================================================
-- 3. reprocess_creative: bumps processing_version and always creates a
--    genuinely NEW job (enqueue_media_processing_job's idempotency key
--    includes the version, so re-calling with the same version would be
--    a silent no-op against an already-terminal job).
-- ==================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);

select public.reprocess_creative('27000000-0000-4000-8000-000000000030') as reprocess_job_1 \gset
select is(
  (select processing_version from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000030'),
  2,
  'reprocess_creative bumps processing_version to 2'
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000030'),
  'queued',
  'reprocess_creative moves the creative back to queued'
);

reset role;
set local role authenticated;
select public.reprocess_creative('27000000-0000-4000-8000-000000000030') as reprocess_job_2 \gset
select is(
  (select processing_version from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000030'),
  3,
  'a second reprocess bumps processing_version again, to 3'
);
select isnt(
  :'reprocess_job_2'::uuid, :'reprocess_job_1'::uuid,
  'each reprocess call creates a genuinely new job, not a no-op against the previous one'
);
reset role;

-- ==================================================================
-- 4. Stale job reclaim.
-- ==================================================================
insert into public.media_processing_jobs (id, creative_id, media_version, status, attempts, max_attempts, locked_at, locked_by, idempotency_key)
values
  ('27000000-0000-4000-8000-000000000040', '27000000-0000-4000-8000-000000000032', 1, 'processing', 1, 3, now() - interval '20 minutes', 'ghost-worker', 'reclaim-retryable'),
  ('27000000-0000-4000-8000-000000000041', '27000000-0000-4000-8000-000000000033', 1, 'processing', 3, 3, now() - interval '20 minutes', 'ghost-worker', 'reclaim-exhausted'),
  ('27000000-0000-4000-8000-000000000042', '27000000-0000-4000-8000-000000000030', 99, 'processing', 0, 3, now(), 'live-worker', 'reclaim-fresh');
update public.campaign_creatives set processing_status = 'processing' where id in (
  '27000000-0000-4000-8000-000000000032', '27000000-0000-4000-8000-000000000033'
);

select public.reclaim_stale_media_processing_jobs(600) as reclaimed_count \gset
select is(:'reclaimed_count'::integer, 2, 'reclaim finds exactly the two stale jobs, not the fresh one');
select is(
  (select status::text from public.media_processing_jobs where id = '27000000-0000-4000-8000-000000000040'),
  'queued',
  'a stale job with attempts remaining is re-queued'
);
select is(
  (select status::text from public.media_processing_jobs where id = '27000000-0000-4000-8000-000000000041'),
  'failed',
  'a stale job that already exhausted max_attempts is reclaimed straight to failed'
);
select is(
  (select status::text from public.media_processing_jobs where id = '27000000-0000-4000-8000-000000000042'),
  'processing',
  'a job locked moments ago (a real, live worker) is left alone'
);

-- ==================================================================
-- 5. report_media_processing_result retry backoff: a transient failure
--    with attempts remaining re-queues; exhausting max_attempts is
--    terminal. This logic already existed — it just had no direct test.
-- ==================================================================
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum) values (
  '27000000-0000-4000-8000-000000000050', '27000000-0000-4000-8000-000000000020', 'Retry Check', 'video',
  'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000020/retry-check.mp4',
  10, repeat('f', 64)
);
insert into public.media_processing_jobs (id, creative_id, media_version, status, attempts, max_attempts, idempotency_key)
values ('27000000-0000-4000-8000-000000000060', '27000000-0000-4000-8000-000000000050', 1, 'processing', 1, 3, 'retry-check:1');

select public.report_media_processing_result(
  '27000000-0000-4000-8000-000000000060'::uuid, 'failed', null, null, null, null, null, null, 'ffmpeg timed out'
);
select is(
  (select status::text from public.media_processing_jobs where id = '27000000-0000-4000-8000-000000000060'),
  'queued',
  'a transient failure with attempts remaining (1 of 3) re-queues the job'
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '27000000-0000-4000-8000-000000000050'),
  'queued',
  'the creative goes back to queued too, not incompatible or failed'
);

update public.media_processing_jobs set attempts = 3, status = 'processing' where id = '27000000-0000-4000-8000-000000000060';
select public.report_media_processing_result(
  '27000000-0000-4000-8000-000000000060'::uuid, 'failed', null, null, null, null, null, null, 'ffmpeg timed out again'
);
select is(
  (select status::text from public.media_processing_jobs where id = '27000000-0000-4000-8000-000000000060'),
  'failed',
  'a transient failure that has exhausted max_attempts (3 of 3) becomes terminal'
);

-- ==================================================================
-- 6. Publication is blocked while the only active creative isn't ready.
-- ==================================================================
insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values (
  '27000000-0000-4000-8000-000000000021', '27000000-0000-4000-8000-000000000010', 'Blocked Publish', 'regular', 'draft',
  now() - interval '1 day', now() + interval '30 days', '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
);
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum, processing_status) values (
  '27000000-0000-4000-8000-000000000070', '27000000-0000-4000-8000-000000000021', 'Incompatible Creative', 'video',
  'advertisers/27000000-0000-4000-8000-000000000010/campaigns/27000000-0000-4000-8000-000000000021/incompatible.mp4',
  10, repeat('g', 64), 'incompatible'
);
select throws_ok(
  $$update public.campaigns set status = 'active' where id = '27000000-0000-4000-8000-000000000021'$$,
  '23514',
  'Campaign is not structurally ready for activation.',
  'a campaign whose only active creative is incompatible cannot be published'
);

select * from finish();
rollback;
