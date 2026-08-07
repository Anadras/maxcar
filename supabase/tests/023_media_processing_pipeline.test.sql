begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(23);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('23000000-0000-4000-8000-000000000001', 'commercial23@example.test', '{}', now(), now());
update public.profiles set role = 'commercial' where id = '23000000-0000-4000-8000-000000000001';

insert into public.advertisers (id, legal_name, trade_name) values
  ('23000000-0000-4000-8000-000000000030', 'Advertiser M13 Ltda', 'Advertiser M13');
insert into public.campaigns (id, advertiser_id, name, campaign_type, status) values
  ('23000000-0000-4000-8000-000000000040', '23000000-0000-4000-8000-000000000030', 'Campaign M13', 'regular', 'draft');
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum, original_storage_path) values (
  '23000000-0000-4000-8000-000000000050', '23000000-0000-4000-8000-000000000040', 'creative', 'video',
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/original.mp4',
  10, 'abc123',
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/original.mp4'
);

-- MAX-017: the TESTE01 incident (reg03/regular04 served their raw,
-- untranscoded original and never rendered a first frame on real
-- hardware) traced back to this exact default. A new creative must now
-- explicitly earn 'ready' — see 027_media_pipeline_safe_default.test.sql
-- for the trigger that also rejects an INSERT claiming 'ready' outright
-- without a processed derivative, and for proof a genuinely legacy row
-- (inserted with processing_status='ready' explicitly, the one-time
-- backfill shape) still works.
select is(
  (select processing_status::text from public.campaign_creatives
   where id = '23000000-0000-4000-8000-000000000050'),
  'uploaded',
  'a newly-inserted creative starts life uploaded, never silently ready'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000001', true);

select public.enqueue_media_processing_job('23000000-0000-4000-8000-000000000050') as job_id \gset
select isnt(:'job_id'::uuid, null, 'enqueue_media_processing_job returns a job id');
select is(
  (select processing_status::text from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000050'),
  'queued',
  'enqueuing moves the creative to queued'
);

select public.enqueue_media_processing_job('23000000-0000-4000-8000-000000000050') as job_id_2 \gset
select is(:'job_id_2'::uuid, :'job_id'::uuid, 'enqueuing the same creative+version again returns the same job (idempotent)');
select is(
  (select count(*)::integer from public.media_processing_jobs where creative_id = '23000000-0000-4000-8000-000000000050'),
  1,
  'no duplicate job row was created'
);

reset role;

select creative_id from public.claim_next_media_processing_job('worker-test-1') \gset claimed_
select is(
  :'claimed_creative_id'::uuid, '23000000-0000-4000-8000-000000000050'::uuid,
  'claim_next_media_processing_job returns the queued job'
);
select is(
  (select status::text from public.media_processing_jobs where id = :'job_id'::uuid),
  'processing',
  'claiming marks the job processing'
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000050'),
  'processing',
  'claiming marks the creative processing'
);

-- A second claim attempt finds nothing left (SKIP LOCKED correctness at
-- the single-job level — the concurrency guarantee itself needs two real
-- simultaneous sessions to prove fully, out of scope for pgTAP).
select is(
  (select job_id from public.claim_next_media_processing_job('worker-test-2')),
  null,
  'a second claim attempt finds no other queued job'
);

select public.report_media_processing_result(
  :'job_id'::uuid, 'ready', 'media-processed/x/hash.mp4', 'deadbeef', 12345, 10000,
  '{"codec":"h264"}'::jsonb, 'maxcar-mediatek-v1', null
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000050'),
  'ready',
  'a ready result marks the creative ready with its derivative recorded'
);
select is(
  (select processed_storage_path from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000050'),
  'media-processed/x/hash.mp4',
  'the processed storage path is recorded — the tablet reads this, never original_storage_path'
);

-- MAX-018 regression: original_storage_path is never set by the real
-- admin upload flow (apps/admin/.../creative-actions.ts inserts only
-- storage_path) — this row is deliberately built the same way, with no
-- original_storage_path at all, to prove enqueue_media_processing_job
-- backfills it itself rather than handing the worker a null path (which
-- crashed every single job in production: job.ts's originalExtension()
-- calling .split('.') on null).
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum) values (
  '23000000-0000-4000-8000-000000000060', '23000000-0000-4000-8000-000000000040', 'no original path', 'video',
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/no-original.mp4',
  10, 'def456'
);
select is(
  (select original_storage_path from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000060'),
  null,
  'mirroring the real admin insert: original_storage_path starts null, just like production'
);

set local role authenticated;
select public.enqueue_media_processing_job('23000000-0000-4000-8000-000000000060') as job_id_3 \gset
reset role;

select is(
  (select original_storage_path from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000060'),
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/no-original.mp4',
  'enqueue_media_processing_job backfills original_storage_path from storage_path'
);
select is(
  (select original_storage_path from public.claim_next_media_processing_job('worker-test-3') where creative_id = '23000000-0000-4000-8000-000000000060'),
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/no-original.mp4',
  'the worker claim now receives a real, non-null path to download'
);

-- MAX-018 regression #2: a job superseded by a newer reprocess_creative
-- call (media_version no longer matches the creative's current
-- processing_version) must never write to campaign_creatives again —
-- found live when two zombie v2 jobs for reg03/regular04, retried after
-- a v3 reprocess had already started, tried to report 'failed' and got
-- permanently wedged by campaign_creatives_preserve_active_readiness
-- (which correctly rejects an active campaign's sole creative going
-- terminally failed). The fix makes a stale job close itself out instead
-- of ever touching the creative it no longer owns.
insert into public.campaign_creatives (id, campaign_id, name, creative_type, storage_path, duration_seconds, checksum) values (
  '23000000-0000-4000-8000-000000000070', '23000000-0000-4000-8000-000000000040', 'stale job race', 'video',
  'advertisers/23000000-0000-4000-8000-000000000030/campaigns/23000000-0000-4000-8000-000000000040/stale-race.mp4',
  10, 'aaa111'
);

set local role authenticated;
select public.enqueue_media_processing_job('23000000-0000-4000-8000-000000000070') as job_a_id \gset
reset role;
select job_id from public.claim_next_media_processing_job('worker-test-4') \gset claim_a_
select is(:'claim_a_job_id'::uuid, :'job_a_id'::uuid, 'job A (v1) is claimed and now processing');

-- An operator reprocesses the same creative while job A is still
-- in-flight: version bumps to 2, a genuinely new job B is created, and
-- the creative moves back to queued under job B's authority.
set local role authenticated;
select set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000001', true);
select public.reprocess_creative('23000000-0000-4000-8000-000000000070') as job_b_id \gset
reset role;
select is(
  (select processing_version from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000070'),
  2,
  'reprocessing mid-flight bumps the creative to processing_version 2'
);

-- Job A (still v1) reports progress: must not regress the creative,
-- which job B now owns.
select public.report_media_processing_progress(:'job_a_id'::uuid, 'probing');
select is(
  (select processing_status::text from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000070'),
  'queued',
  'a stale job A progress report does not regress the creative away from queued (job B''s state)'
);

-- Job A (still v1) reports a terminal 'ready' — must not resurrect it as
-- the creative's status, and must close job A out cleanly instead of
-- ever touching campaign_creatives.
select public.report_media_processing_result(
  :'job_a_id'::uuid, 'ready', 'media-processed/stale/should-not-apply.mp4', 'deadbeef', 1, 1, null, 'maxcar-mediatek-v1', null
);
select is(
  (select processing_status::text from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000070'),
  'queued',
  'a stale job A terminal report does not overwrite the creative''s status'
);
select is(
  (select processed_storage_path from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000070'),
  null,
  'a stale job A terminal report does not write its processed_storage_path onto the creative'
);
select is(
  (select status::text from public.media_processing_jobs where id = :'job_a_id'::uuid),
  'failed',
  'the stale job A itself is closed out as failed, not left wedged in processing forever'
);
select ok(
  (select last_error ilike '%Superseded%' from public.media_processing_jobs where id = :'job_a_id'::uuid),
  'the stale job A records why it was closed out'
);

-- Job B (the current version) still resolves normally.
select job_id from public.claim_next_media_processing_job('worker-test-5') \gset claim_b_
select is(:'claim_b_job_id'::uuid, :'job_b_id'::uuid, 'job B (v2, the current version) is claimed normally');
select public.report_media_processing_result(
  :'job_b_id'::uuid, 'ready', 'media-processed/current/wins.mp4', 'cafef00d', 1, 1, null, 'maxcar-mediatek-v1', null
);
select is(
  (select processed_storage_path from public.campaign_creatives where id = '23000000-0000-4000-8000-000000000070'),
  'media-processed/current/wins.mp4',
  'the current job (matching processing_version) still applies its result normally'
);

select * from finish();
rollback;
