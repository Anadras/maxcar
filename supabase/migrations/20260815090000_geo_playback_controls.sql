-- MAX-011: explicit control over *when* a GEO campaign takes over from
-- whatever is currently playing on entering its geofence, on top of the
-- existing priority/cooldown model. Same two-tier design MAX-008 already
-- established for priority/cooldown: a campaign-level default
-- (`campaigns.playback_mode`/`max_wait_seconds`), optionally overridden per
-- geofence (`campaign_geofences.playback_mode_override`/
-- `max_wait_seconds_override`) — get_device_geo_rules resolves both the
-- same way it already resolves priority/cooldown.

create type public.geo_playback_mode as enum (
  'immediate', 'after_current', 'max_wait'
);

-- Backfilled to 'after_current' for every existing campaign — today's only
-- behavior (a GEO candidate is offered exclusively at an item boundary,
-- never mid-play) — so this migration never silently changes what an
-- already-configured campaign does. Forms default *new* GEO campaigns to
-- 'immediate' client-side; the column default here is a safety net for
-- existing rows and for any insert that omits the field, not the UX
-- default.
alter table public.campaigns
  add column playback_mode public.geo_playback_mode not null default 'after_current',
  add column max_wait_seconds integer not null default 5;

alter table public.campaigns
  add constraint campaigns_max_wait_seconds_check
  check (max_wait_seconds between 1 and 30);

alter table public.campaign_geofences
  add column playback_mode_override public.geo_playback_mode,
  add column max_wait_seconds_override integer;

alter table public.campaign_geofences
  add constraint campaign_geofences_max_wait_seconds_check
  check (
    max_wait_seconds_override is null
    or max_wait_seconds_override between 1 and 30
  );

comment on column public.campaigns.playback_mode is
  'Default interruption behavior when this GEO campaign becomes eligible: immediate (interrupts whatever is playing within ~2s), after_current (waits for the current item to finish, MAX-008''s original behavior), max_wait (waits up to max_wait_seconds, then interrupts).';
comment on column public.campaign_geofences.playback_mode_override is
  'Per-geofence override of campaigns.playback_mode. Null means "use the campaign default" — mirrors priority_override/cooldown_override_seconds.';

-- create or replace can't add columns to a table function's return type —
-- drop first, same pattern every prior get_device_geo_rules-adjacent
-- revision in this codebase follows.
drop function if exists public.get_device_geo_rules(text);

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
        'playbackMode', upper(coalesce(cg.playback_mode_override, c.playback_mode)::text),
        'maxWaitSeconds', coalesce(cg.max_wait_seconds_override, c.max_wait_seconds),
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

-- Panel visibility: the geofence-form UI (MAX-011) needs to show what a
-- null override actually resolves to, without a second round trip — the
-- same "*.*"-style convenience campaign_admin_view already gets for
-- playback_mode/max_wait_seconds automatically (it selects c.*).
create or replace view public.campaign_geofence_admin_view
with (security_invoker = true)
as
select
  cg.id,
  cg.campaign_id,
  c.name as campaign_name,
  c.advertiser_id,
  a.trade_name as advertiser_name,
  cg.establishment_id,
  e.name as establishment_name,
  e.city,
  e.state,
  extensions.st_y(e.location::extensions.geometry) as latitude,
  extensions.st_x(e.location::extensions.geometry) as longitude,
  cg.radius_meters,
  cg.priority_override,
  cg.cooldown_override_seconds,
  cg.active,
  cg.created_at,
  cg.updated_at,
  -- Appended at the end, never inserted earlier in the list: CREATE OR
  -- REPLACE VIEW treats a new column in the middle of an existing select
  -- list as renaming whatever column used to sit at that position.
  cg.playback_mode_override,
  cg.max_wait_seconds_override,
  c.priority as campaign_priority,
  c.cooldown_seconds as campaign_cooldown_seconds,
  c.playback_mode as campaign_playback_mode,
  c.max_wait_seconds as campaign_max_wait_seconds
from public.campaign_geofences cg
join public.campaigns c on c.id = cg.campaign_id
join public.establishments e on e.id = cg.establishment_id
left join public.advertisers a on a.id = c.advertiser_id;

revoke all on public.campaign_geofence_admin_view from public, anon;
grant select on public.campaign_geofence_admin_view to authenticated;

-- `select c.*` in a view is expanded to a literal column list at the time
-- the view is (re)created, positionally — Postgres does not re-resolve it
-- just because the underlying table gained columns, and CREATE OR REPLACE
-- VIEW only allows *appending* new columns at the very end of the output,
-- never shifting an existing one's position. `c.*` would now expand to two
-- more columns than before, shifting every column listed after it
-- (advertiser_name onward) — so this spells out campaigns' pre-existing
-- columns by name (preserving their exact original order) instead of
-- `c.*`, with playback_mode/max_wait_seconds appended only at the true end
-- of the select list, after impression_count.
create or replace view public.campaign_admin_view
with (security_invoker = true)
as
select
  c.id,
  c.advertiser_id,
  c.name,
  c.campaign_type,
  c.status,
  c.starts_at,
  c.ends_at,
  c.daily_start_time,
  c.daily_end_time,
  c.priority,
  c.cooldown_seconds,
  c.max_daily_impressions,
  c.active_days,
  c.created_at,
  c.updated_at,
  a.trade_name as advertiser_name,
  (select count(*)::integer
   from public.campaign_creatives cc
   where cc.campaign_id = c.id and cc.active) as creative_count,
  (select count(*)::integer
   from public.campaign_geofences cg
   where cg.campaign_id = c.id and cg.active) as geofence_count,
  (select count(*)::bigint
   from public.impressions i
   where i.campaign_id = c.id) as impression_count,
  c.playback_mode,
  c.max_wait_seconds
from public.campaigns c
left join public.advertisers a on a.id = c.advertiser_id;

revoke all on public.campaign_admin_view from public, anon;
grant select on public.campaign_admin_view to authenticated;
