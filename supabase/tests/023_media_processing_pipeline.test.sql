begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

select * from finish();
rollback;
