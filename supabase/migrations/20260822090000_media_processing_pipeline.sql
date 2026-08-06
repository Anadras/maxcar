-- MAX-013: schema for the media validation/transcoding pipeline proposed
-- in docs/architecture/MEDIA_VALIDATION_PIPELINE_PROPOSAL.md. Additive
-- only — every creative already active today backfills straight to
-- 'ready' with no reprocessing, so no existing campaign's playback
-- changes because of this migration alone.

create type public.media_processing_status as enum (
  'uploaded', 'queued', 'processing', 'probing', 'transcoding',
  'validating_output', 'ready', 'incompatible', 'failed'
);

alter table public.campaign_creatives
  add column processing_status public.media_processing_status not null default 'ready',
  add column original_storage_path text,
  add column processed_storage_path text,
  add column original_sha256 text,
  add column processed_sha256 text,
  add column processing_error text,
  add column processing_attempts integer not null default 0,
  add column processing_started_at timestamptz,
  add column processing_finished_at timestamptz,
  add column validated_at timestamptz,
  add column media_probe jsonb,
  add column processed_media_probe jsonb,
  add column compatibility_profile text,
  add column processing_version integer not null default 1,
  add column original_size_bytes bigint,
  add column processed_size_bytes bigint,
  add column original_duration_ms integer,
  add column processed_duration_ms integer;

comment on column public.campaign_creatives.processing_status is
  'uploaded->queued->processing->probing->transcoding->validating_output->ready, or ->incompatible/failed. Every row that existed before this column was added defaults to ready (already-active creatives were never retroactively reprocessed).';
comment on column public.campaign_creatives.processing_error is
  'Short, user-safe failure description — never a full stack trace, same rule as impressions.failure_reason.';

-- The actual publication gate (section 14 of the MAX-013 brief): a
-- campaign is never structurally ready while its active creative hasn't
-- cleared the pipeline at least once. Existing campaigns are unaffected
-- (their creatives already defaulted to processing_status = 'ready'
-- above).
--
-- Deliberately also accepts a creative that is CURRENTLY mid-reprocessing
-- (status back to queued/processing/etc.) as long as it still has a
-- processed derivative on file from a prior successful run
-- (processed_storage_path is not null): campaign_creatives carries an
-- AFTER UPDATE constraint trigger (campaign_creatives_preserve_active_
-- readiness, see 20260728090700) that re-checks this function on every
-- row update and throws if it goes false while the campaign is active.
-- Without this OR clause, the pipeline's own claim_next_media_processing_
-- job — which flips an already-live campaign's sole creative to
-- 'processing' the moment a re-upload is queued — would be rejected by
-- that trigger on every single call, making reprocessing of any live
-- campaign impossible. The already-processed derivative keeps serving
-- (see get_device_manifest/get_device_geo_rules) until the new one lands.
create or replace function private.campaign_is_structurally_ready(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    c.starts_at is not null
    and c.ends_at is not null
    and c.ends_at >= c.starts_at
    and cardinality(c.active_days) between 1 and 7
    and exists (
      select 1
      from public.campaign_creatives cc
      where cc.campaign_id = c.id and cc.active
        and (cc.processing_status = 'ready' or cc.processed_storage_path is not null)
    )
    and (
      c.campaign_type = 'regular'
      or exists (
        select 1
        from public.campaign_geofences cg
        where cg.campaign_id = c.id and cg.active
      )
    ),
    false
  )
  from public.campaigns c
  where c.id = p_campaign_id
$$;

-- ==================================================================
-- Job queue: FOR UPDATE SKIP LOCKED, the standard Postgres queue
-- pattern — no external broker needed at this pilot's volume (dozens of
-- uploads/week, not thousands).
-- ==================================================================

create table public.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.campaign_creatives(id) on delete cascade,
  media_version integer not null,
  status public.media_processing_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  idempotency_key text not null,
  constraint media_processing_jobs_idempotency_key_unique unique (idempotency_key)
);

comment on column public.media_processing_jobs.idempotency_key is
  'creative_id || ":" || media_version — a retry or a duplicate webhook delivery for the same upload can never enqueue two jobs for it.';

create index media_processing_jobs_status_available_idx
  on public.media_processing_jobs (status, available_at)
  where status in ('queued', 'processing');
create index media_processing_jobs_creative_id_idx
  on public.media_processing_jobs (creative_id);

alter table public.media_processing_jobs enable row level security;
grant select on public.media_processing_jobs to authenticated;

create policy media_processing_jobs_staff_select
  on public.media_processing_jobs
  for select
  to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations', 'commercial'));

-- Enqueues a job the moment a creative is uploaded (called from the
-- upload flow, alongside the existing campaign_creatives insert) — never
-- automatic on every campaign_creatives write, since re-processing an
-- already-ready creative on an unrelated column update (e.g. `active`
-- toggling) would be wasted work.
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

-- Worker-facing: atomically claim the next available job. SECURITY
-- DEFINER + service_role-only, same pattern as every device-* RPC — the
-- worker authenticates with its own dedicated credential (see the
-- pipeline proposal doc's "Segurança" section), never the panel's
-- session.
create or replace function public.claim_next_media_processing_job(p_worker_id text)
returns table (
  job_id uuid,
  creative_id uuid,
  media_version integer,
  attempts integer,
  original_storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select j.id into v_job_id
  from public.media_processing_jobs j
  where j.status = 'queued' and j.available_at <= now()
  order by j.created_at
  limit 1
  for update skip locked;

  if v_job_id is null then
    return;
  end if;

  update public.media_processing_jobs as j
  set status = 'processing', locked_at = now(), locked_by = p_worker_id,
      attempts = j.attempts + 1
  where j.id = v_job_id;

  update public.campaign_creatives cc
  set processing_status = 'processing', processing_started_at = now()
  from public.media_processing_jobs j
  where j.id = v_job_id and cc.id = j.creative_id;

  return query
  select j.id, j.creative_id, j.media_version, j.attempts, cc.original_storage_path
  from public.media_processing_jobs j
  join public.campaign_creatives cc on cc.id = j.creative_id
  where j.id = v_job_id;
end;
$$;

revoke all on function public.claim_next_media_processing_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_media_processing_job(text) to service_role;

-- Worker-facing: report an intermediate state (probing/transcoding/
-- validating_output) purely for panel visibility — never a terminal
-- outcome, see report_media_processing_result for that.
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
begin
  if p_status not in ('probing', 'transcoding', 'validating_output') then
    raise exception using errcode = '22023', message = 'Not a valid intermediate status.';
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

-- Worker-facing: the terminal outcome — ready (with the derivative's
-- path/hash/probe) or incompatible/failed (with a sanitized reason).
-- failed (not incompatible) re-queues automatically up to max_attempts
-- (retry backoff itself is the worker's own responsibility — see the
-- pipeline proposal's retry table — this just tracks the count and the
-- final give-up).
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
  v_attempts integer;
  v_max_attempts integer;
begin
  if p_status not in ('ready', 'incompatible', 'failed') then
    raise exception using errcode = '22023', message = 'Not a terminal status.';
  end if;

  select j.creative_id, j.attempts, j.max_attempts into v_creative_id, v_attempts, v_max_attempts
  from public.media_processing_jobs j where j.id = p_job_id;

  if v_creative_id is null then
    raise exception using errcode = '22023', message = 'Job not found.';
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
