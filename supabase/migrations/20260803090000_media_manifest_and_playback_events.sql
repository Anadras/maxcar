-- MAX-007: device media manifest, offline playback events and the minimal
-- playlist-to-device link the pilot needs. All new device-facing functions
-- follow the MAX-006 pattern: granted only to service_role, called only by
-- the device Edge Functions, and always deriving device identity from the
-- caller's hashed bearer token (private.device_id_for_token) — the Android
-- app never supplies device_id itself.

-- A playlist with device_id set is specific to that device; a playlist with
-- device_id null is the pilot's global default grade, used by any device
-- without a dedicated one. Both are optional per-row states, not a new
-- table, since the existing 1:1-link style (driver<->vehicle,
-- vehicle<->device) already fits: at most one *active* playlist per device,
-- and at most one *active* global default.
alter table public.playlists
  add column device_id uuid references public.devices (id) on delete cascade;

create index playlists_device_id_idx on public.playlists (device_id);

create unique index playlists_one_active_per_device
  on public.playlists (device_id)
  where active and device_id is not null;

-- A constant-expression partial unique index enforces "at most one" over a
-- filtered condition with no natural key of its own.
create unique index playlists_one_active_global_default
  on public.playlists ((true))
  where active and device_id is null;

comment on column public.playlists.device_id is
  'Null means the pilot global default grade, used by any device without a dedicated playlist.';

-- The regular grade only ever holds REGULAR campaigns; GEO campaigns are
-- scheduled through campaign_geofences and the future Location Engine, not
-- through playlist position. Mirrors campaigns_geo_requires_geofence's
-- "REGULAR campaigns can't receive a geofence" symmetry.
create or replace function private.validate_playlist_item_campaign_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_type public.campaign_type;
begin
  select campaign_type into v_campaign_type
  from public.campaigns
  where id = new.campaign_id;

  if v_campaign_type <> 'regular' then
    raise exception using
      errcode = '23514',
      message = 'Only REGULAR campaigns can be added to a playlist.';
  end if;
  return new;
end;
$$;

create trigger playlist_items_validate_campaign_type
  before insert or update of campaign_id on public.playlist_items
  for each row execute function private.validate_playlist_item_campaign_type();

-- Derives the MIME type from the (already-validated, extension-constrained)
-- storage path instead of a stored column: campaign_creatives' own
-- validate_campaign_media_path trigger already limits every path to
-- jpg/jpeg/png/webp/mp4/webm, so the extension is a trustworthy source.
create or replace function private.creative_mime_type(p_storage_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(substring(p_storage_path from '\.([a-zA-Z0-9]+)$'))
    when 'mp4' then 'video/mp4'
    when 'webm' then 'video/webm'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'webp' then 'image/webp'
    else 'application/octet-stream'
  end
$$;

revoke all on function private.creative_mime_type(text) from public, anon, authenticated;

-- The manifest a device syncs against. Returns a single JSON document
-- (header + ordered playlist) rather than a row set, since an empty grade
-- is a normal, first-class outcome (new/idle device) and a table-returning
-- function can't express "zero items but still a valid header" cleanly.
--
-- Eligibility mirrors private.campaign_is_structurally_ready plus the
-- REGULAR-only, active-period rule from item 12 of the MAX-007 brief —
-- reusing the existing readiness function rather than re-deriving it keeps
-- one source of truth for "is this campaign actually ready".
--
-- Deliberately does NOT include a download URL: that requires calling
-- Supabase Storage's signed-URL API, which only exists in the JS/HTTP
-- client, not in SQL. The device-manifest Edge Function attaches a signed
-- URL per item after calling this function.
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
      cc.checksum,
      jsonb_build_object(
        'campaignId', c.id,
        'creativeId', cc.id,
        'type', cc.creative_type,
        'mimeType', private.creative_mime_type(cc.storage_path),
        'durationSeconds', cc.duration_seconds,
        'fileSizeBytes', cc.file_size_bytes,
        'sha256', cc.checksum,
        'storagePath', cc.storage_path,
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
  ) entry;

  return jsonb_build_object(
    'manifestVersion', coalesce(v_version, '0'),
    'generatedAt', now(),
    'deviceId', v_device_id,
    'playlist', v_items
  );
end;
$$;

revoke all on function public.get_device_manifest(text) from public, anon, authenticated;
grant execute on function public.get_device_manifest(text) to service_role;

-- Player-state summary carried on the existing heartbeat, additive and
-- entirely optional so old app builds keep working unchanged (item 39: "não
-- quebrar contrato atual"). last_error is free text but is meant for a
-- short, user-safe diagnostic string — never a stack trace.
alter table public.device_heartbeats
  add column player_state text,
  add column media_ready_count integer,
  add column manifest_version text,
  add column current_campaign_id uuid references public.campaigns (id) on delete set null,
  add column current_creative_id uuid references public.campaign_creatives (id) on delete set null,
  add column last_error text;

alter table public.device_heartbeats
  add constraint device_heartbeats_media_ready_count_check
  check (media_ready_count is null or media_ready_count >= 0);

-- create or replace can't change a function's parameter list in place: with
-- a different signature it defines a second overload instead of replacing
-- the original, and callers using the old parameter set then fail with
-- "function is not unique". Drop the MAX-006 signature explicitly first.
drop function if exists public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid
);

create or replace function public.record_device_heartbeat(
  p_token text,
  p_battery_level smallint default null,
  p_network_type text default 'offline',
  p_storage_free_bytes bigint default null,
  p_app_version text default null,
  p_device_time timestamptz default null,
  p_client_event_id uuid default null,
  p_player_state text default null,
  p_media_ready_count integer default null,
  p_manifest_version text default null,
  p_current_campaign_id uuid default null,
  p_current_creative_id uuid default null,
  p_last_error text default null
)
returns table (out_device_id uuid, device_code text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_recorded_at timestamptz;
  v_network_connected boolean := coalesce(p_network_type, 'offline') <> 'offline';
begin
  v_device_id := private.device_id_for_token(p_token);

  insert into public.device_heartbeats (
    device_id, recorded_at, battery_level, network_connected, gps_available,
    storage_free_bytes, app_version, client_event_id,
    player_state, media_ready_count, manifest_version,
    current_campaign_id, current_creative_id, last_error
  ) values (
    v_device_id, now(), p_battery_level, v_network_connected, false,
    p_storage_free_bytes, p_app_version, p_client_event_id,
    p_player_state, p_media_ready_count, p_manifest_version,
    p_current_campaign_id, p_current_creative_id, p_last_error
  )
  on conflict (device_id, client_event_id) where client_event_id is not null
  do nothing
  returning device_heartbeats.recorded_at into v_recorded_at;

  if v_recorded_at is null then
    -- A retried client_event_id: report the original heartbeat's time
    -- instead of a fresh one, since nothing new was written.
    select device_heartbeats.recorded_at into v_recorded_at
    from public.device_heartbeats
    where device_id = v_device_id and client_event_id = p_client_event_id;
  end if;

  update public.devices
  set last_seen_at = v_recorded_at, last_sync_at = v_recorded_at
  where id = v_device_id;

  return query select v_device_id as out_device_id, d.device_code, v_recorded_at from public.devices d where d.id = v_device_id;
end;
$$;

comment on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text
) is
  'p_device_time is accepted as client metadata only; recorded_at is always the server clock, never the tablet clock.';

revoke all on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(
  text, smallint, text, bigint, text, timestamptz, uuid,
  text, integer, text, uuid, uuid, text
) to service_role;

-- Proof-of-play events sync as one finalized row per playback attempt, not
-- a live start/stop pair: the Android app only enqueues an event locally
-- once playback has actually ended (naturally, by error, or left
-- incomplete by an app/device restart), then syncs whatever is queued.
-- This lets the server side stay a single idempotent insert, exactly like
-- record_device_heartbeat, instead of needing an update-in-place upsert.
alter table public.impressions
  add column failure_reason text;

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
  v_inserted uuid;
begin
  v_device_id := private.device_id_for_token(p_token);

  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'clientEventId is required.';
  end if;
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign_id and campaign_type = 'regular'
  ) then
    raise exception using errcode = '22023', message = 'campaignId must reference a REGULAR campaign.';
  end if;

  select vehicle_id into v_vehicle_id from public.devices where id = v_device_id;

  insert into public.impressions (
    device_id, vehicle_id, campaign_id, creative_id, source, status,
    started_at, completed_at, duration_ms, completion_percentage,
    offline_generated, client_event_id, failure_reason
  ) values (
    v_device_id, v_vehicle_id, p_campaign_id, p_creative_id, 'regular', p_status,
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

comment on column public.impressions.failure_reason is
  'Short, user-safe failure description for status = failed. Never a stack trace.';
