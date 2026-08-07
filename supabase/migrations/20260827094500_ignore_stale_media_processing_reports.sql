-- MAX-018 follow-up #2: found live while re-running reprocess_creative
-- against reg03/regular04 after the two migrations above. The two v2
-- jobs that had already crashed against the null original_storage_path
-- bug (51f1bfa5-93c7-4608-9cb0-09bcb39bad9c, c6552d5d-e70a-4411-be7c-
-- bcfa95e086b3) were still 'queued' when reprocess_creative bumped both
-- creatives to processing_version 3 and enqueued fresh v3 jobs. The
-- worker picked the stale v2 jobs up again (attempts already exhausted
-- from the earlier crash loop), and report_media_processing_result tried
-- to mark their creative 'failed' — at that moment each creative was the
-- sole structurally-qualifying creative of an active campaign, so
-- campaign_creatives_preserve_active_readiness correctly threw 23514,
-- rolling back that call entirely and leaving both jobs permanently
-- wedged: status stuck at 'processing', attempts at 3/3, no way for any
-- future retry to ever resolve them (each retry hits the exact same
-- rollback). The v3 jobs succeeded independently and both creatives are
-- 'ready' today — but the underlying gap is real and not specific to
-- this incident: report_media_processing_result never checks whether the
-- reporting job is still the creative's CURRENT version. Any operator
-- clicking "reprocess" while a previous job for the same creative is
-- still in flight hits this exact race.
--
-- Fix: a job whose media_version no longer matches the creative's current
-- processing_version is stale — superseded by a newer reprocess_creative
-- call. Its own job row still gets closed out (for audit history), but it
-- must never write to campaign_creatives again: a newer job already owns
-- that creative's current status, and letting a stale job's terminal
-- write fight the active-campaign trigger is exactly the wedge this
-- guards against.
-- Same staleness gap, smaller blast radius: an intermediate progress
-- report from a stale job can't trip the readiness trigger (every value
-- in this function's allowed set is already a tolerated in-flight
-- status), but it could still silently regress a creative that a newer
-- job has already moved on from — e.g. a zombie v2 job reporting
-- 'probing' after the v3 job already reached 'ready'. Same fix, same
-- reasoning.
create or replace function public.report_media_processing_progress(
  p_job_id uuid,
  p_status public.media_processing_status,
  p_media_probe jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_version integer;
  v_current_version integer;
begin
  if p_status not in ('probing', 'transcoding', 'validating_output') then
    raise exception using errcode = '22023', message = 'Not a valid intermediate status.';
  end if;

  select j.media_version, cc.processing_version into v_media_version, v_current_version
  from public.media_processing_jobs j
  join public.campaign_creatives cc on cc.id = j.creative_id
  where j.id = p_job_id;

  if v_media_version is distinct from v_current_version then
    return;
  end if;

  update public.campaign_creatives cc
  set processing_status = p_status,
      media_probe = coalesce(p_media_probe, cc.media_probe)
  from public.media_processing_jobs j
  where j.id = p_job_id and cc.id = j.creative_id;
end;
$$;

revoke all on function public.report_media_processing_progress(uuid, public.media_processing_status, jsonb) from public, anon, authenticated;
grant execute on function public.report_media_processing_progress(uuid, public.media_processing_status, jsonb) to service_role;

create or replace function public.report_media_processing_result(
  p_job_id uuid,
  p_status public.media_processing_status,
  p_processed_storage_path text default null,
  p_processed_sha256 text default null,
  p_processed_size_bytes bigint default null,
  p_processed_duration_ms integer default null,
  p_processed_media_probe jsonb default null,
  p_compatibility_profile text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creative_id uuid;
  v_media_version integer;
  v_attempts integer;
  v_max_attempts integer;
  v_current_version integer;
begin
  if p_status not in ('ready', 'incompatible', 'failed') then
    raise exception using errcode = '22023', message = 'Not a terminal status.';
  end if;

  select j.creative_id, j.media_version, j.attempts, j.max_attempts
  into v_creative_id, v_media_version, v_attempts, v_max_attempts
  from public.media_processing_jobs j where j.id = p_job_id;

  if v_creative_id is null then
    raise exception using errcode = '22023', message = 'Job not found.';
  end if;

  select cc.processing_version into v_current_version
  from public.campaign_creatives cc where cc.id = v_creative_id;

  if v_media_version <> v_current_version then
    update public.media_processing_jobs
    set status = 'failed', completed_at = now(),
        last_error = coalesce(p_error, 'Superseded by a newer reprocess before this job completed.')
    where id = p_job_id;
    return;
  end if;

  if p_status = 'failed' and v_attempts < v_max_attempts then
    -- Transient failure with attempts remaining: re-queue, never
    -- INCOMPATIBLE for something that might just be infra flakiness.
    update public.media_processing_jobs
    set status = 'queued', locked_at = null, locked_by = null,
        last_error = p_error, available_at = now() + (v_attempts * interval '1 minute')
    where id = p_job_id;
    update public.campaign_creatives
    set processing_status = 'queued', processing_error = p_error
    where id = v_creative_id;
    return;
  end if;

  update public.media_processing_jobs
  set status = p_status, completed_at = now(), last_error = p_error
  where id = p_job_id;

  update public.campaign_creatives
  set processing_status = p_status,
      processing_error = p_error,
      processing_finished_at = now(),
      validated_at = case when p_status = 'ready' then now() else validated_at end,
      processed_storage_path = coalesce(p_processed_storage_path, processed_storage_path),
      processed_sha256 = coalesce(p_processed_sha256, processed_sha256),
      processed_size_bytes = coalesce(p_processed_size_bytes, processed_size_bytes),
      processed_duration_ms = coalesce(p_processed_duration_ms, processed_duration_ms),
      processed_media_probe = coalesce(p_processed_media_probe, processed_media_probe),
      compatibility_profile = coalesce(p_compatibility_profile, compatibility_profile)
  where id = v_creative_id;
end;
$$;

revoke all on function public.report_media_processing_result(
  uuid, public.media_processing_status, text, text, bigint, integer, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.report_media_processing_result(
  uuid, public.media_processing_status, text, text, bigint, integer, jsonb, text, text
) to service_role;

comment on function public.report_media_processing_result(
  uuid, public.media_processing_status, text, text, bigint, integer, jsonb, text, text
) is 'Applies a job''s terminal outcome to its creative, unless the job''s media_version no longer matches the creative''s current processing_version — a stale job (superseded by a newer reprocess_creative call) closes out its own row only and never touches campaign_creatives.';
