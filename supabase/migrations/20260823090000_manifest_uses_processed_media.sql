-- MAX-013 section 15: the manifest/GEO-rules endpoints must only ever
-- hand the tablet a *processed* derivative — never a freshly-uploaded
-- original the pipeline hasn't cleared yet. coalesce(processed_*, *)
-- means a legacy creative (processing_status defaulted straight to
-- 'ready', processed_storage_path never populated because it predates
-- this pipeline) keeps working exactly as before — this is the
-- "LEGACY_READY" continuity the brief asks for, without a separate
-- status value: the fallback IS the continuity mechanism.
--
-- Also tightens the lateral join in both functions to require the
-- specific creative selected to itself have cleared the pipeline at
-- least once (not just "some creative of this campaign is ready", which
-- is all private.campaign_is_structurally_ready's own EXISTS check
-- verifies) — a campaign with two creatives, one ready and one still
-- processing, must never have the *unready* one selected here.
--
-- "Cleared the pipeline at least once" (processing_status = 'ready' OR
-- processed_storage_path is not null), not a bare processing_status =
-- 'ready' check, so a live campaign mid-reprocessing keeps serving its
-- last-known-good derivative instead of vanishing from the manifest —
-- see the matching comment on private.campaign_is_structurally_ready in
-- 20260822090000_media_processing_pipeline.sql for why.

create or replace function public.get_device_manifest(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_playlist_id uuid;
  v_items jsonb;
  v_version text;
begin
  v_device_id := private.device_id_for_token(p_token);

  select id into v_playlist_id
  from public.playlists
  where device_id = v_device_id and active
  limit 1;

  if v_playlist_id is null then
    select id into v_playlist_id
    from public.playlists
    where device_id is null and active
    limit 1;
  end if;

  select
    coalesce(jsonb_agg(entry.item order by entry.position), '[]'::jsonb),
    md5(coalesce(string_agg(entry.creative_id::text || ':' || entry.checksum, ',' order by entry.position), ''))
  into v_items, v_version
  from (
    select
      pi.position,
      cc.id as creative_id,
      coalesce(cc.processed_sha256, cc.checksum) as checksum,
      jsonb_build_object(
        'campaignId', c.id,
        'creativeId', cc.id,
        'type', cc.creative_type,
        'mimeType', private.creative_mime_type(coalesce(cc.processed_storage_path, cc.storage_path)),
        'durationSeconds', cc.duration_seconds,
        'fileSizeBytes', coalesce(cc.processed_size_bytes, cc.file_size_bytes),
        'sha256', coalesce(cc.processed_sha256, cc.checksum),
        'storagePath', coalesce(cc.processed_storage_path, cc.storage_path),
        'compatibilityProfile', cc.compatibility_profile,
        'startsAt', c.starts_at,
        'endsAt', c.ends_at,
        'position', pi.position
      ) as item
    from public.playlist_items pi
    join public.campaigns c on c.id = pi.campaign_id
    join lateral (
      select cc2.*
      from public.campaign_creatives cc2
      where cc2.campaign_id = c.id and cc2.active
        and (cc2.processing_status = 'ready' or cc2.processed_storage_path is not null)
      order by cc2.created_at
      limit 1
    ) cc on true
    where pi.playlist_id = v_playlist_id
      and pi.active
      and c.status = 'active'
      and c.campaign_type = 'regular'
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at is null or c.ends_at >= now())
      and private.campaign_is_structurally_ready(c.id)
      and (
        not exists (select 1 from public.campaign_devices cd where cd.campaign_id = c.id)
        or exists (
          select 1 from public.campaign_devices cd
          where cd.campaign_id = c.id and cd.device_id = v_device_id
        )
      )
  ) entry;

  return jsonb_build_object(
    'manifestVersion', coalesce(v_version, '0'),
    'generatedAt', now(),
    'deviceId', v_device_id,
    'playlist', v_items
  );
end;
$$;

create or replace function public.get_device_geo_rules(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_rules jsonb;
  v_version text;
begin
  v_device_id := private.device_id_for_token(p_token);

  select
    coalesce(jsonb_agg(entry.item order by entry.geofence_id), '[]'::jsonb),
    md5(coalesce(string_agg(
      entry.geofence_id::text || ':' || entry.creative_id::text || ':' || entry.checksum,
      ',' order by entry.geofence_id
    ), ''))
  into v_rules, v_version
  from (
    select
      cg.id as geofence_id,
      cc.id as creative_id,
      coalesce(cc.processed_sha256, cc.checksum) as checksum,
      jsonb_build_object(
        'geofenceId', cg.id,
        'campaignId', c.id,
        'creativeId', cc.id,
        'establishmentId', e.id,
        'latitude', extensions.st_y(e.location::extensions.geometry),
        'longitude', extensions.st_x(e.location::extensions.geometry),
        'radiusMeters', cg.radius_meters,
        'priority', coalesce(cg.priority_override, c.priority),
        'cooldownSeconds', coalesce(cg.cooldown_override_seconds, c.cooldown_seconds),
        'playbackMode', upper(coalesce(cg.playback_mode_override, c.playback_mode)::text),
        'maxWaitSeconds', coalesce(cg.max_wait_seconds_override, c.max_wait_seconds),
        'type', cc.creative_type,
        'mimeType', private.creative_mime_type(coalesce(cc.processed_storage_path, cc.storage_path)),
        'durationSeconds', cc.duration_seconds,
        'fileSizeBytes', coalesce(cc.processed_size_bytes, cc.file_size_bytes),
        'sha256', coalesce(cc.processed_sha256, cc.checksum),
        'storagePath', coalesce(cc.processed_storage_path, cc.storage_path),
        'startsAt', c.starts_at,
        'endsAt', c.ends_at
      ) as item
    from public.campaign_geofences cg
    join public.campaigns c on c.id = cg.campaign_id
    join public.establishments e on e.id = cg.establishment_id
    join lateral (
      select cc2.*
      from public.campaign_creatives cc2
      where cc2.campaign_id = c.id and cc2.active
        and (cc2.processing_status = 'ready' or cc2.processed_storage_path is not null)
      order by cc2.created_at
      limit 1
    ) cc on true
    where cg.active
      and e.active
      and c.status = 'active'
      and c.campaign_type = 'geo'
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at is null or c.ends_at >= now())
      and private.campaign_is_structurally_ready(c.id)
  ) entry;

  return jsonb_build_object(
    'rulesVersion', coalesce(v_version, '0'),
    'generatedAt', now(),
    'deviceId', v_device_id,
    'rules', v_rules
  );
end;
$$;
