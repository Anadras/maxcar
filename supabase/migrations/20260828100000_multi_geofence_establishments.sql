-- MAX-020 (Fase 2): an establishment moves from "one point = one implicit
-- geofence per campaign" to owning its own set of named, independently
-- located/sized geofences ("vários endereços; vários pontos de exibição;
-- diferentes raios") — a real mall has more than one entrance a vehicle
-- can be detected near. campaign_geofences already was, structurally, a
-- pure campaign<->place join row (it never carried more than one place
-- per row) — this migration keeps it exactly that (a GEO campaign can
-- still link to one or many geofences, N:N, nothing new needed there) and
-- moves the place itself (point + radius) out to its own first-class
-- table owned by the establishment, not the campaign.
--
-- Backward compatibility, verified below and in
-- supabase/tests/029_multi_geofence_establishments.test.sql:
--   - every existing campaign_geofences row is backfilled into exactly
--     one new geofences row (same point, same radius) before the old
--     establishment_id/radius_meters columns are ever dropped;
--   - get_device_geo_rules keeps emitting `geofenceId` as
--     campaign_geofences.id (never geofences.id) — the Android app's
--     GeoRuleEntity primary key and every downstream diff/cooldown/
--     dedupe keyed off it are completely unaware this migration exists;
--   - priority/cooldown/playback-mode override resolution
--     (coalesce(override, campaign default)), IMMEDIATE/AFTER_CURRENT/
--     MAX_WAIT, campaign_is_structurally_ready's GEO-needs-an-active-
--     geofence-link check, and the "only GEO campaigns can have
--     geofences" / "same advertiser" / "active campaign can't lose its
--     last geofence" triggers are all preserved, just repointed through
--     the new table.

create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete restrict,
  name text not null,
  location extensions.geography(Point, 4326) not null,
  radius_meters integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.geofences
  add constraint geofences_name_not_blank check (btrim(name) <> ''),
  add constraint geofences_radius_check check (radius_meters > 0 and radius_meters <= 100000);

create index geofences_establishment_id_idx on public.geofences (establishment_id);
create index geofences_location_gist_idx on public.geofences using gist ((location::extensions.geometry));
create index geofences_active_establishment_idx on public.geofences (establishment_id) where active;

create trigger geofences_set_updated_at before update on public.geofences
  for each row execute function public.set_updated_at();

comment on table public.geofences is
  'A named point + radius belonging to one establishment ("um estabelecimento pode possuir vários pontos de exibição") — the actual place a GEO campaign can be linked to via campaign_geofences. Distinct from campaign_geofences.id, which stays the wire-facing "geofenceId" the Android app has always known (see get_device_geo_rules).';

-- Every pre-existing table got this same blanket grant the moment RLS was
-- introduced (20260728090400_authorization_and_rls.sql:318) — a table
-- created afterward needs it explicitly, or every policy below is dead
-- code (RLS is only ever consulted after the underlying GRANT already
-- allows the operation).
grant select, insert, update, delete on public.geofences to authenticated;

alter table public.geofences enable row level security;

create policy geofences_select on public.geofences
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or exists (
      select 1 from public.establishments e
      where e.id = establishment_id and e.advertiser_id = private.current_advertiser_id()
    )
  );
create policy geofences_staff_write on public.geofences
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy geofences_advertiser_insert on public.geofences
  for insert to authenticated
  with check (
    exists (
      select 1 from public.establishments e
      where e.id = establishment_id and e.advertiser_id = private.current_advertiser_id()
    )
  );
create policy geofences_advertiser_update on public.geofences
  for update to authenticated
  using (
    exists (
      select 1 from public.establishments e
      where e.id = establishment_id and e.advertiser_id = private.current_advertiser_id()
    )
  )
  with check (
    exists (
      select 1 from public.establishments e
      where e.id = establishment_id and e.advertiser_id = private.current_advertiser_id()
    )
  );

-- Write API, same shape/validation as save_establishment (MAX-003) — a
-- geography point can't be built from a plain INSERT without either a
-- trigger or an RPC, and every other point-writing path in this codebase
-- already uses the RPC approach.
create or replace function public.save_geofence(
  p_id uuid,
  p_establishment_id uuid,
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer,
  p_active boolean
)
returns public.geofences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.geofences;
  point extensions.geography(Point, 4326);
begin
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using errcode = '22023', message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = '22023', message = 'Longitude must be between -180 and 180.';
  end if;
  if p_radius_meters <= 0 or p_radius_meters > 100000 then
    raise exception using errcode = '22023', message = 'Radius must be between 1 and 100000 meters.';
  end if;

  point := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  if p_id is null then
    insert into public.geofences (establishment_id, name, location, radius_meters, active)
    values (p_establishment_id, btrim(p_name), point, p_radius_meters, p_active)
    returning * into saved;
  else
    update public.geofences
    set establishment_id = p_establishment_id,
        name = btrim(p_name),
        location = point,
        radius_meters = p_radius_meters,
        active = p_active
    where id = p_id
    returning * into saved;

    if saved.id is null then
      raise exception using errcode = 'P0002', message = 'Geofence not found.';
    end if;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_geofence(
  uuid, uuid, text, double precision, double precision, integer, boolean
) from public, anon;
grant execute on function public.save_geofence(
  uuid, uuid, text, double precision, double precision, integer, boolean
) to authenticated;

-- Backfill: exactly one geofences row per existing campaign_geofences
-- row, same point (copied from the establishment it used to point at
-- directly) and same radius — never deduplicated across rows, so an
-- existing assignment's exact behavior is bit-for-bit preserved even if
-- two campaigns happened to already share an establishment.
alter table public.campaign_geofences add column geofence_id uuid;

insert into public.geofences (id, establishment_id, name, location, radius_meters, active, created_at, updated_at)
select
  gen_random_uuid(),
  cg.establishment_id,
  e.name,
  e.location,
  cg.radius_meters,
  true,
  cg.created_at,
  cg.updated_at
from public.campaign_geofences cg
join public.establishments e on e.id = cg.establishment_id
returning id;

-- The insert above can't correlate its generated ids back to the
-- campaign_geofences rows it came from in one statement (no natural key
-- to join on — an establishment can legitimately supply more than one
-- backfilled geofence). Match them the honest way: one row at a time, in
-- a stable order, since every campaign_geofences row produced exactly one
-- geofences row above in the same relative order.
do $$
declare
  v_cg record;
  v_geofence_id uuid;
begin
  for v_cg in select id, establishment_id, radius_meters from public.campaign_geofences order by created_at loop
    select g.id into v_geofence_id
    from public.geofences g
    where g.establishment_id = v_cg.establishment_id
      and g.radius_meters = v_cg.radius_meters
      and g.id not in (
        select geofence_id from public.campaign_geofences where geofence_id is not null
      )
    order by g.created_at
    limit 1;
    update public.campaign_geofences set geofence_id = v_geofence_id where id = v_cg.id;
  end loop;
end;
$$;

alter table public.campaign_geofences alter column geofence_id set not null;
alter table public.campaign_geofences
  add constraint campaign_geofences_geofence_id_fkey
  foreign key (geofence_id) references public.geofences(id) on delete restrict;

create index campaign_geofences_geofence_id_idx on public.campaign_geofences (geofence_id);

alter table public.campaign_geofences
  drop constraint campaign_geofences_campaign_establishment_unique;
alter table public.campaign_geofences
  add constraint campaign_geofences_campaign_geofence_unique unique (campaign_id, geofence_id);

comment on column public.campaign_geofences.geofence_id is
  'The place (public.geofences) this campaign is linked to. A GEO campaign can link to one or many geofences (this table stays the N:N join) — radius/location now live on the geofence itself, never here.';

create view public.geofence_admin_view
with (security_invoker = true)
as
select
  g.id,
  g.establishment_id,
  e.name as establishment_name,
  e.advertiser_id,
  a.trade_name as advertiser_name,
  e.city,
  e.state,
  g.name,
  extensions.st_y(g.location::extensions.geometry) as latitude,
  extensions.st_x(g.location::extensions.geometry) as longitude,
  g.radius_meters,
  g.active,
  g.created_at,
  g.updated_at,
  (select count(*)::integer from public.campaign_geofences cg where cg.geofence_id = g.id) as campaign_link_count
from public.geofences g
join public.establishments e on e.id = g.establishment_id
left join public.advertisers a on a.id = e.advertiser_id;

revoke all on public.geofence_admin_view from public, anon;
grant select on public.geofence_admin_view to authenticated;

-- Re-point the relationship/ownership trigger: establishment_id no longer
-- exists on this table, so both checks resolve through geofences now.
create or replace function private.validate_campaign_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_advertiser uuid;
  campaign_kind public.campaign_type;
  geofence_establishment_advertiser uuid;
begin
  select advertiser_id, campaign_type
  into campaign_advertiser, campaign_kind
  from public.campaigns
  where id = new.campaign_id;

  select e.advertiser_id
  into geofence_establishment_advertiser
  from public.geofences g
  join public.establishments e on e.id = g.establishment_id
  where g.id = new.geofence_id;

  if campaign_kind <> 'geo' then
    raise exception using
      errcode = '23514',
      message = 'Only GEO campaigns can have geofences.';
  end if;
  if campaign_advertiser is distinct from geofence_establishment_advertiser then
    raise exception using
      errcode = '23514',
      message = 'Campaign and establishment must belong to the same advertiser.';
  end if;
  return new;
end;
$$;

drop trigger campaign_geofences_validate_relationship on public.campaign_geofences;
create trigger campaign_geofences_validate_relationship
  before insert or update of campaign_id, geofence_id
  on public.campaign_geofences
  for each row execute function private.validate_campaign_geofence();

-- get_device_geo_rules: same jsonb shape, same "geofenceId" =
-- campaign_geofences.id wire contract — only the internal join/columns
-- feeding latitude/longitude/radiusMeters move from establishments
-- directly to geofences. g.active is a new condition (a geofence can now
-- be independently deactivated without touching the campaign link or the
-- establishment) — never true today for any existing row (the backfill
-- above always sets active = true), so this is additive, not a behavior
-- change for anything that exists right now.
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
        'latitude', extensions.st_y(g.location::extensions.geometry),
        'longitude', extensions.st_x(g.location::extensions.geometry),
        'radiusMeters', g.radius_meters,
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
    join public.geofences g on g.id = cg.geofence_id
    join public.establishments e on e.id = g.establishment_id
    join public.campaigns c on c.id = cg.campaign_id
    join lateral (
      select cc2.*
      from public.campaign_creatives cc2
      where cc2.campaign_id = c.id and cc2.active
        and (cc2.processing_status = 'ready' or cc2.processed_storage_path is not null)
      order by cc2.created_at
      limit 1
    ) cc on true
    where cg.active
      and g.active
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

-- campaign_geofence_admin_view: exact same pre-existing column list/order
-- (every value still means the same thing — establishment_id/latitude/
-- longitude/radius_meters now resolved via geofences, not directly) so
-- every existing Admin read keeps working unchanged; geofence_id/
-- geofence_name/geofence_active are appended at the very end, the only
-- position CREATE OR REPLACE VIEW allows adding columns.
create or replace view public.campaign_geofence_admin_view
with (security_invoker = true)
as
select
  cg.id,
  cg.campaign_id,
  c.name as campaign_name,
  c.advertiser_id,
  a.trade_name as advertiser_name,
  g.establishment_id,
  e.name as establishment_name,
  e.city,
  e.state,
  extensions.st_y(g.location::extensions.geometry) as latitude,
  extensions.st_x(g.location::extensions.geometry) as longitude,
  g.radius_meters,
  cg.priority_override,
  cg.cooldown_override_seconds,
  cg.active,
  cg.created_at,
  cg.updated_at,
  cg.playback_mode_override,
  cg.max_wait_seconds_override,
  c.priority as campaign_priority,
  c.cooldown_seconds as campaign_cooldown_seconds,
  c.playback_mode as campaign_playback_mode,
  c.max_wait_seconds as campaign_max_wait_seconds,
  g.id as geofence_id,
  g.name as geofence_name,
  g.active as geofence_active
from public.campaign_geofences cg
join public.geofences g on g.id = cg.geofence_id
join public.establishments e on e.id = g.establishment_id
join public.campaigns c on c.id = cg.campaign_id
left join public.advertisers a on a.id = c.advertiser_id;

revoke all on public.campaign_geofence_admin_view from public, anon;
grant select on public.campaign_geofence_admin_view to authenticated;

-- simulate_geofence_eligibility: same signature/return shape, distance
-- and radius now resolved via geofences.
create or replace function public.simulate_geofence_eligibility(
  p_geofence_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_at timestamptz default now(),
  p_operational_timezone text default 'America/Campo_Grande'
)
returns table (
  geofence_id uuid,
  campaign_id uuid,
  campaign_name text,
  establishment_name text,
  distance_meters double precision,
  radius_meters integer,
  within_radius boolean,
  eligible boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  vehicle_point extensions.geography(Point, 4326);
begin
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using errcode = '22023', message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = '22023', message = 'Longitude must be between -180 and 180.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = p_operational_timezone
  ) then
    raise exception using errcode = '22023', message = 'Invalid operational timezone.';
  end if;

  vehicle_point := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  return query
  select
    cg.id,
    c.id,
    c.name,
    e.name,
    measured.distance,
    g.radius_meters,
    measured.distance <= g.radius_meters,
    (
      measured.distance <= g.radius_meters
      and cg.active
      and g.active
      and e.active
      and c.status = 'active'
      and c.campaign_type = 'geo'
      and (c.starts_at is null or p_at >= c.starts_at)
      and (c.ends_at is null or p_at <= c.ends_at)
      and extract(dow from p_at at time zone p_operational_timezone)::smallint = any(c.active_days)
      and (
        c.daily_start_time is null
        or c.daily_end_time is null
        or (
          c.daily_start_time <= c.daily_end_time
          and (p_at at time zone p_operational_timezone)::time
            between c.daily_start_time and c.daily_end_time
        )
        or (
          c.daily_start_time > c.daily_end_time
          and (
            (p_at at time zone p_operational_timezone)::time >= c.daily_start_time
            or (p_at at time zone p_operational_timezone)::time <= c.daily_end_time
          )
        )
      )
      and exists (
        select 1 from public.campaign_creatives cc
        where cc.campaign_id = c.id and cc.active
      )
    )
  from public.campaign_geofences cg
  join public.geofences g on g.id = cg.geofence_id
  join public.campaigns c on c.id = cg.campaign_id
  join public.establishments e on e.id = g.establishment_id
  cross join lateral (
    select extensions.st_distance(g.location, vehicle_point) as distance
  ) measured
  where cg.id = p_geofence_id;
end;
$$;

-- test_geo_campaign_delivery: same jsonb shape/keys, distance and radius
-- resolved via geofences.
create or replace function public.test_geo_campaign_delivery(
  p_device_id uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_device_location extensions.geography(Point, 4326);
  v_device_allowed boolean;
  v_geofences jsonb;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can run the GEO test tool.';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if v_campaign.id is null then
    raise exception using errcode = '22023', message = 'Campaign not found.';
  end if;
  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  select hb.location into v_device_location
  from public.device_heartbeats hb
  where hb.device_id = p_device_id
  order by hb.recorded_at desc
  limit 1;

  v_device_allowed := not exists (
    select 1 from public.campaign_devices cd where cd.campaign_id = p_campaign_id
  ) or exists (
    select 1 from public.campaign_devices cd
    where cd.campaign_id = p_campaign_id and cd.device_id = p_device_id
  );

  select coalesce(jsonb_agg(entry.item order by entry.geofence_id), '[]'::jsonb)
  into v_geofences
  from (
    select
      cg.id as geofence_id,
      jsonb_build_object(
        'geofenceId', cg.id,
        'establishmentName', e.name,
        'latitude', extensions.st_y(g.location::extensions.geometry),
        'longitude', extensions.st_x(g.location::extensions.geometry),
        'radiusMeters', g.radius_meters,
        'geofenceActive', cg.active,
        'establishmentActive', e.active,
        'distanceMeters', case
          when v_device_location is null then null
          else round(extensions.st_distance(g.location, v_device_location)::numeric, 1)
        end,
        'insideRadius', case
          when v_device_location is null then null
          else extensions.st_distance(g.location, v_device_location) <= g.radius_meters
        end
      ) as item
    from public.campaign_geofences cg
    join public.geofences g on g.id = cg.geofence_id
    join public.establishments e on e.id = g.establishment_id
    where cg.campaign_id = p_campaign_id
  ) entry;

  return jsonb_build_object(
    'campaignId', p_campaign_id,
    'deviceId', p_device_id,
    'simulated', true,
    'campaignType', v_campaign.campaign_type,
    'campaignActive', v_campaign.status = 'active',
    'withinScheduleWindow',
      (v_campaign.starts_at is null or v_campaign.starts_at <= now())
      and (v_campaign.ends_at is null or v_campaign.ends_at >= now()),
    'structurallyReady', private.campaign_is_structurally_ready(p_campaign_id),
    'deviceAllowed', v_device_allowed,
    'deviceHasKnownLocation', v_device_location is not null,
    'geofences', v_geofences
  );
end;
$$;

-- delete_establishment_permanently: the two campaign_geofences lookups
-- keyed off establishment_id now resolve through geofences; the
-- establishment's own geofences rows must be explicitly cleared first
-- (on delete restrict, same discipline this function already uses for
-- every other dependent table).
create or replace function public.delete_establishment_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.establishments%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.establishments where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Establishment not found.'; end if;
  update public.campaigns set status = 'paused'
    where id in (
      select cg.campaign_id from public.campaign_geofences cg
      join public.geofences g on g.id = cg.geofence_id
      where g.establishment_id = p_id
    )
    and status = 'active';
  delete from public.geofence_events where campaign_geofence_id in (
    select cg.id from public.campaign_geofences cg
    join public.geofences g on g.id = cg.geofence_id
    where g.establishment_id = p_id
  );
  delete from public.campaign_geofences where geofence_id in (
    select id from public.geofences where establishment_id = p_id
  );
  delete from public.geofences where establishment_id = p_id;
  delete from public.establishments where id = p_id;
  perform private.record_audit_event('delete', 'establishment', p_id, v_row.name, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

-- Only safe now that every trigger/view/function that used to read these
-- two columns directly (validate_campaign_geofence,
-- campaign_geofence_admin_view, get_device_geo_rules,
-- simulate_geofence_eligibility, test_geo_campaign_delivery) has already
-- been repointed through public.geofences above.
alter table public.campaign_geofences drop column establishment_id;
alter table public.campaign_geofences drop column radius_meters;
