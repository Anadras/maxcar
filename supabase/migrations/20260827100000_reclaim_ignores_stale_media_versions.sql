-- MAX-018 follow-up #3: same staleness gap as 20260827094500, found by
-- reading the sibling function it didn't touch. reclaim_stale_media_
-- processing_jobs unconditionally writes campaign_creatives for any
-- job it reclaims, exactly like the report_media_processing_result bug
-- fixed above — except this one fires on its own schedule (the worker
-- calls it at the top of every loop, and MEDIA_WORKER_STALE_JOB_TIMEOUT_
-- SECONDS is 900s), with no operator action required. The two zombie v2
-- jobs left over from the original_storage_path incident
-- (51f1bfa5-93c7-4608-9cb0-09bcb39bad9c, c6552d5d-e70a-4411-be7c-
-- bcfa95e086b3 — both status='processing', attempts=3/3, for creatives
-- that are now genuinely 'ready' via their v3 jobs) would otherwise get
-- reclaimed into the exhausted-attempts branch about 15 minutes from now
-- and try to stamp campaign_creatives back to 'failed' on an active
-- campaign's now-ready sole creative — either rolled back by
-- campaign_creatives_preserve_active_readiness (re-wedging them exactly
-- as before) or, worse on a campaign where that check doesn't apply,
-- silently regressing a working ready creative back to failed. Same
-- fix, same reasoning: a reclaimed job whose media_version no longer
-- matches its creative's current processing_version closes out its own
-- row only.
create or replace function public.reclaim_stale_media_processing_jobs(
  p_stale_after_seconds integer default 600
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reclaimed integer := 0;
  v_job record;
  v_current_version integer;
begin
  for v_job in
    select j.id, j.creative_id, j.media_version, j.attempts, j.max_attempts
    from public.media_processing_jobs j
    where j.status = 'processing'
      and j.locked_at is not null
      and j.locked_at < now() - make_interval(secs => p_stale_after_seconds)
    for update skip locked
  loop
    select cc.processing_version into v_current_version
    from public.campaign_creatives cc where cc.id = v_job.creative_id;

    if v_job.media_version <> v_current_version then
      update public.media_processing_jobs
      set status = 'failed', completed_at = now(),
          last_error = 'Superseded by a newer reprocess before this job completed.'
      where id = v_job.id;
      v_reclaimed := v_reclaimed + 1;
      continue;
    end if;

    if v_job.attempts < v_job.max_attempts then
      update public.media_processing_jobs
      set status = 'queued', locked_at = null, locked_by = null,
          last_error = 'Reclaimed: worker went silent mid-job.',
          available_at = now()
      where id = v_job.id;
      update public.campaign_creatives
      set processing_status = 'queued',
          processing_error = 'Reclaimed: worker went silent mid-job.'
      where id = v_job.creative_id;
    else
      update public.media_processing_jobs
      set status = 'failed', completed_at = now(),
          last_error = 'Reclaimed after exhausting retries: worker went silent mid-job.'
      where id = v_job.id;
      update public.campaign_creatives
      set processing_status = 'failed',
          processing_error = 'Reclaimed after exhausting retries: worker went silent mid-job.',
          processing_finished_at = now()
      where id = v_job.creative_id;
    end if;
    v_reclaimed := v_reclaimed + 1;
  end loop;
  return v_reclaimed;
end;
$$;

revoke all on function public.reclaim_stale_media_processing_jobs(integer) from public, anon, authenticated;
grant execute on function public.reclaim_stale_media_processing_jobs(integer) to service_role;

comment on function public.reclaim_stale_media_processing_jobs(integer) is
  'Requeues (or, past max_attempts, fails) a job whose worker went silent mid-lock. A job whose media_version no longer matches its creative''s current processing_version is stale — superseded by a newer reprocess_creative call — and is closed out on its own row only, never touching campaign_creatives.';
