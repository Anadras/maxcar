-- MAX-008: GEO rule delivery and GEO event ingestion for the Android tablet.
-- Mirrors the MAX-007 manifest/playback-event pattern exactly: a single
-- SECURITY DEFINER function per concern, granted only to service_role,
-- device identity always re-derived from the caller's hashed bearer token.
--
-- GEO campaigns reuse the exact same secure media pipeline as REGULAR
-- (manifest -> signed URL -> download -> hash -> local file -> playback ->
-- event): get_device_geo_rules below returns creative fields shaped
-- identically to get_device_manifest's playlist items, so the Android
-- downloader can treat both the same way.

-- Idempotency for geofence transition events, same pattern as
-- impressions/device_heartbeats: a device may retry after a dropped
-- response without creating a duplicate row.
alter table public.geofence_events
  add column client_event_id uuid,
  add column accuracy_meters numeric(6, 2);

alter table public.geofence_events
  add constraint geofence_events_accuracy_check
  check (accuracy_meters is null or accuracy_meters >= 0);

create unique index geofence_events_device_client_event_unique
  on public.geofence_events (device_id, client_event_id)
  where client_event_id is not null;

comment on column public.geofence_events.accuracy_meters is
  'Fused Location Provider accuracy at the moment of the transition, for panel diagnostics only.';

-- The GEO rules a device evaluates locally and offline. Same shape as
-- private.creative_mime_type / get_device_manifest's eligibility: reuses
-- private.campaign_is_structurally_ready as the single source of truth for
-- "is this campaign actually ready", and the same active/period filter as
-- the REGULAR manifest. Geofence-specific fields (radius, priority,
-- cooldown) let the effective per-campaign override win over the campaign
-- default, exactly like campaign_geofence_admin_view already does for the
-- panel.
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
      cc.checksum,
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
        'type', cc.creative_type,
        'mimeType', private.creative_mime_type(cc.storage_path),
        'durationSeconds', cc.duration_seconds,
        'fileSizeBytes', cc.file_size_bytes,
        'sha256', cc.checksum,
        'storagePath', cc.storage_path,
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

revoke all on function public.get_device_geo_rules(text) from public, anon, authenticated;
grant execute on function public.get_device_geo_rules(text) to service_role;

-- Geofence transition ingestion (OUTSIDE->ENTERED, INSIDE->EXITED etc, one
-- row per transition the Android state machine makes, not a continuous
-- stream). p_campaign_geofence_id must be a real, currently active-or-not
-- geofence row (kept even if the geofence is later deactivated, so history
-- isn't lost) so the event always resolves back to a campaign/establishment.
create or replace function public.record_device_geofence_event(
  p_token text,
  p_campaign_geofence_id uuid,
  p_event_type public.geofence_event_type,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric default null,
  p_distance_meters numeric default null,
  p_occurred_at timestamptz default now(),
  p_client_event_id uuid default null
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_point extensions.geography(Point, 4326);
  v_inserted uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'clientEventId is required.';
  end if;
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using errcode = '22023', message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = '22023', message = 'Longitude must be between -180 and 180.';
  end if;
  if not exists (select 1 from public.campaign_geofences where id = p_campaign_geofence_id) then
    raise exception using errcode = '22023', message = 'geofenceId does not reference a known geofence.';
  end if;

  v_point := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude), 4326
  )::extensions.geography;

  insert into public.geofence_events (
    device_id, campaign_geofence_id, event_type, occurred_at,
    location, accuracy_meters, distance_meters, client_event_id
  ) values (
    v_device_id, p_campaign_geofence_id, p_event_type, p_occurred_at,
    v_point, p_accuracy_meters, p_distance_meters, p_client_event_id
  )
  on conflict (device_id, client_event_id) where client_event_id is not null
  do nothing
  returning id into v_inserted;

  return query select v_inserted is not null;
end;
$$;

revoke all on function public.record_device_geofence_event(
  text, uuid, public.geofence_event_type, double precision, double precision,
  numeric, numeric, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.record_device_geofence_event(
  text, uuid, public.geofence_event_type, double precision, double precision,
  numeric, numeric, timestamptz, uuid
) to service_role;

-- record_device_playback_event (MAX-007) hardcoded source = 'regular' and
-- rejected anything but a REGULAR campaign_id: GEO campaigns now play
-- through the same proof-of-play path, so source is derived from the
-- campaign's own campaign_type instead of a client-supplied or hardcoded
-- value (never trust the client to say whether its own event is GEO).
create or replace function public.record_device_playback_event(
  p_token text,
  p_campaign_id uuid,
  p_creative_id uuid,
  p_status public.impression_status,
  p_started_at timestamptz,
  p_completed_at timestamptz default null,
  p_duration_ms integer default null,
  p_completion_percentage numeric default null,
  p_failure_reason text default null,
  p_offline boolean default false,
  p_client_event_id uuid default null
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_vehicle_id uuid;
  v_source public.impression_source;
  v_inserted uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'clientEventId is required.';
  end if;

  select campaign_type::text::public.impression_source into v_source
  from public.campaigns
  where id = p_campaign_id;

  if v_source is null then
    raise exception using errcode = '22023', message = 'campaignId does not reference a known campaign.';
  end if;

  select vehicle_id into v_vehicle_id from public.devices where id = v_device_id;

  insert into public.impressions (
    device_id, vehicle_id, campaign_id, creative_id, source, status,
    started_at, completed_at, duration_ms, completion_percentage,
    offline_generated, client_event_id, failure_reason
  ) values (
    v_device_id, v_vehicle_id, p_campaign_id, p_creative_id, v_source, p_status,
    p_started_at, p_completed_at, p_duration_ms, p_completion_percentage,
    coalesce(p_offline, false), p_client_event_id, p_failure_reason
  )
  on conflict (device_id, client_event_id) do nothing
  returning id into v_inserted;

  return query select v_inserted is not null;
end;
$$;

revoke all on function public.record_device_playback_event(
  text, uuid, uuid, public.impression_status, timestamptz, timestamptz,
  integer, numeric, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.record_device_playback_event(
  text, uuid, uuid, public.impression_status, timestamptz, timestamptz,
  integer, numeric, text, boolean, uuid
) to service_role;

comment on function public.get_device_geo_rules(text) is
  'Offline-capable GEO geofence rules for the Location Engine; same creative shape as get_device_manifest so both share one download pipeline.';
comment on function public.record_device_geofence_event(
  text, uuid, public.geofence_event_type, double precision, double precision,
  numeric, numeric, timestamptz, uuid
) is 'One row per state-machine transition (enter/exit/dwell), not a continuous location stream.';
