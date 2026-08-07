-- MAX-018: real bug found operating reprocess_creative for the first time
-- against reg03/regular04 — both are the sole active creative of an
-- already-active campaign, with no processed_storage_path (never
-- successfully processed once). reprocess_creative flips processing_status
-- to 'queued', which campaign_creatives_preserve_active_readiness (an
-- AFTER UPDATE constraint trigger calling campaign_is_structurally_ready)
-- correctly rejects today — 'queued' satisfies neither side of the
-- existing OR (processing_status = 'ready' OR processed_storage_path is
-- not null), so an active campaign whose only creative is being
-- reprocessed for the FIRST time can never be reprocessed at all. The
-- pipeline already special-cases this for a creative being RE-processed
-- (see 20260822090000's comment: "still has a processed derivative on
-- file from a prior successful run") — this just extends the same
-- leniency to a creative that's genuinely, visibly mid-pipeline for the
-- first time, not silently claiming readiness.
--
-- This does not reopen the safe-default gap from 20260826090000: the
-- manifest/geo-rules queries have their own, unchanged, stricter WHERE
-- clause (processing_status = 'ready' OR processed_storage_path is not
-- null) — a 'queued'/'processing'/etc. creative is still never served to
-- a tablet. All this changes is whether an active campaign is allowed to
-- keep existing while its content is being (re)validated, exactly the
-- same tolerance already granted to a re-upload of an already-ready
-- creative.
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
        and (
          cc.processing_status = 'ready'
          or cc.processed_storage_path is not null
          or cc.processing_status in (
            'queued', 'processing', 'probing', 'transcoding', 'validating_output'
          )
        )
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

comment on function private.campaign_is_structurally_ready(uuid) is
  'A campaign stays "structurally ready" (and can be activated) while its active creative is ready, has ever produced a processed derivative, or is currently mid-pipeline (queued through validating_output) — never while incompatible or failed. This is the activation/stay-active gate only; get_device_manifest and get_device_geo_rules have their own separate, stricter WHERE clause and never serve anything short of a genuine ready+processed_storage_path row.';
