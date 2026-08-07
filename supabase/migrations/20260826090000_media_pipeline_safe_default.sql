-- MAX-017: closes the gap the TESTE01 incident exposed. reg03/regular04
-- had processing_status='ready' and processed_storage_path=null with zero
-- media_processing_jobs rows — they never went near the pipeline. The
-- manifest served their raw, untranscoded originals, which never render a
-- first frame on the pilot's real hardware (26-28 consecutive
-- first_frame_timeout quarantines, confirmed physically on TESTE01).
--
-- 'ready' as the column DEFAULT was a deliberate one-time backfill device
-- (20260822090000: "every creative already active today backfills
-- straight to 'ready'") so ALTER TABLE ADD COLUMN wouldn't retroactively
-- block campaigns that existed before the pipeline did. That backfill
-- already happened — every row that benefited from it already has 'ready'
-- stored as a real, persisted value today and is completely unaffected by
-- this migration. What's fixed here is that the same DEFAULT kept silently
-- applying to every INSERT since, including ones (a raw SQL insert, a
-- future admin path that forgets to set the column) that never touched the
-- worker at all — exactly the hole reg03/regular04 fell through.

alter table public.campaign_creatives
  alter column processing_status set default 'uploaded';

comment on column public.campaign_creatives.processing_status is
  'uploaded->queued->processing->probing->transcoding->validating_output->ready, or ->incompatible/failed. Rows that existed before 20260822090000 added this column were one-time backfilled to ready (never retroactively reprocessed) — that backfill already happened and is not what the column default controls today. The default is uploaded: a new row must explicitly claim ready (or land there via the pipeline), never inherit it silently.';

-- Belt-and-suspenders: even an INSERT that explicitly sets
-- processing_status = 'ready' (bypassing the default entirely) can't
-- claim readiness for a file the pipeline never saw. Never fires on
-- UPDATE, so toggling `active` on an already-legacy row (processed_
-- storage_path already null, status already 'ready' from the one-time
-- backfill years... well, days ago) is untouched.
create or replace function private.reject_unearned_ready_creative()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.processing_status = 'ready' and new.processed_storage_path is null then
    raise exception using errcode = '23514',
      message = 'A new creative cannot be inserted as ready without a processed derivative — it must go through the media pipeline (enqueue_media_processing_job).';
  end if;
  return new;
end;
$$;

create trigger campaign_creatives_reject_unearned_ready
  before insert on public.campaign_creatives
  for each row execute function private.reject_unearned_ready_creative();

-- ==================================================================
-- Stale job reclaim (item 8 "falha do worker"): apps/media-worker's own
-- index.ts already documents the gap — if the worker dies or loses its
-- DB connection mid-job, that job (and its creative) is stuck in
-- 'processing' forever with nothing to reclaim it. Same
-- retry-vs-terminal logic as report_media_processing_result, just
-- triggered by staleness instead of an explicit worker report.
-- ==================================================================
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
begin
  for v_job in
    select j.id, j.creative_id, j.attempts, j.max_attempts
    from public.media_processing_jobs j
    where j.status = 'processing'
      and j.locked_at is not null
      and j.locked_at < now() - make_interval(secs => p_stale_after_seconds)
    for update skip locked
  loop
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

-- ==================================================================
-- Admin "Reprocessar": wraps the version bump + enqueue in one call so
-- the panel never has to coordinate two separate writes. Always forces a
-- genuinely NEW job (enqueue_media_processing_job's idempotency key is
-- creative_id:media_version, so re-enqueuing the same version is a
-- silent no-op against an already-terminal job).
-- ==================================================================
create or replace function public.reprocess_creative(p_creative_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_job_id uuid;
begin
  if private.current_app_role() not in ('super_admin', 'admin', 'operations', 'commercial') then
    raise exception using errcode = '42501', message = 'Not authorized to reprocess media.';
  end if;

  update public.campaign_creatives
  set processing_version = processing_version + 1
  where id = p_creative_id
  returning processing_version into v_next_version;

  if v_next_version is null then
    raise exception using errcode = '22023', message = 'Creative not found.';
  end if;

  v_job_id := public.enqueue_media_processing_job(p_creative_id, v_next_version);
  return v_job_id;
end;
$$;

revoke all on function public.reprocess_creative(uuid) from public, anon;
grant execute on function public.reprocess_creative(uuid) to authenticated;
