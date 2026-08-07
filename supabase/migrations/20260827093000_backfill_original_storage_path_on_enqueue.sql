-- MAX-018 follow-up: original_storage_path (added in 20260822090000) is
-- never written anywhere — not by the admin upload flow
-- (creative-actions.ts inserts only storage_path), not by any trigger.
-- claim_next_media_processing_job hands the worker
-- cc.original_storage_path verbatim, so it's always null, and
-- job.ts's originalExtension() crashes on `null.split('.')` for EVERY
-- job, first-run or reprocess alike — confirmed live against
-- reg03/regular04 right after 20260827090000 unblocked reprocess_creative:
-- both jobs claimed, both crashed with "Cannot read properties of null
-- (reading 'split')", both landed back on processing_status='queued'
-- with attempts incremented. The pipeline has never completed a single
-- job end-to-end.
--
-- storage_path never changes after a creative is inserted (protected by
-- a unique index and only revalidated, never reassigned, by
-- campaign_creatives_validate_storage_path) — it IS the original file
-- for as long as the creative exists. The fix: enqueue_media_processing_job
-- backfills original_storage_path from storage_path (only if not already
-- set, so a future flow that legitimately wants to point at a distinct
-- original is not silently overridden) at the exact moment a job is
-- created — first-time and reprocess both go through this one function.
create or replace function public.enqueue_media_processing_job(
  p_creative_id uuid,
  p_media_version integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_key text := p_creative_id::text || ':' || p_media_version::text;
begin
  if private.current_app_role() not in ('super_admin', 'admin', 'operations', 'commercial') then
    raise exception using errcode = '42501', message = 'Not authorized to enqueue media processing.';
  end if;

  update public.campaign_creatives
  set original_storage_path = coalesce(original_storage_path, storage_path)
  where id = p_creative_id;

  insert into public.media_processing_jobs (creative_id, media_version, idempotency_key)
  values (p_creative_id, p_media_version, v_key)
  on conflict (idempotency_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id from public.media_processing_jobs where idempotency_key = v_key;
  else
    update public.campaign_creatives set processing_status = 'queued' where id = p_creative_id;
  end if;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_media_processing_job(uuid, integer) from public, anon;
grant execute on function public.enqueue_media_processing_job(uuid, integer) to authenticated;

-- No data repair here by design: reg03/regular04's two jobs that already
-- crashed against the null path (51f1bfa5-93c7-4608-9cb0-09bcb39bad9c,
-- c6552d5d-e70a-4411-be7c-bcfa95e086b3) are left exactly as the pipeline
-- left them. The official flow — calling reprocess_creative again — now
-- goes through this fixed function and backfills original_storage_path
-- itself; there is no need to touch campaign_creatives directly.
