-- MAX-004: campaign readiness, private media access and real GEO simulation.

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

create or replace function private.validate_campaign_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and not coalesce(private.campaign_is_structurally_ready(new.id), false) then
    raise exception using
      errcode = '23514',
      message = 'Campaign is not structurally ready for activation.';
  end if;
  return new;
end;
$$;

create trigger campaigns_validate_activation
  before insert or update of status on public.campaigns
  for each row execute function private.validate_campaign_activation();

create or replace function private.validate_campaign_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_advertiser uuid;
  campaign_kind public.campaign_type;
  establishment_advertiser uuid;
begin
  select advertiser_id, campaign_type
  into campaign_advertiser, campaign_kind
  from public.campaigns
  where id = new.campaign_id;

  select advertiser_id
  into establishment_advertiser
  from public.establishments
  where id = new.establishment_id;

  if campaign_kind <> 'geo' then
    raise exception using
      errcode = '23514',
      message = 'Only GEO campaigns can have geofences.';
  end if;
  if campaign_advertiser is distinct from establishment_advertiser then
    raise exception using
      errcode = '23514',
      message = 'Campaign and establishment must belong to the same advertiser.';
  end if;
  return new;
end;
$$;

create trigger campaign_geofences_validate_relationship
  before insert or update of campaign_id, establishment_id
  on public.campaign_geofences
  for each row execute function private.validate_campaign_geofence();

create or replace function private.validate_campaign_media_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_advertiser uuid;
  expected_prefix text;
begin
  select advertiser_id into campaign_advertiser
  from public.campaigns
  where id = new.campaign_id;

  expected_prefix :=
    'advertisers/' || campaign_advertiser::text ||
    '/campaigns/' || new.campaign_id::text || '/';

  if new.storage_path not like expected_prefix || '%'
     or new.storage_path !~ '^[a-z0-9/_-]+\.(jpg|jpeg|png|webp|mp4|webm)$' then
    raise exception using
      errcode = '23514',
      message = 'Creative storage path does not match campaign ownership.';
  end if;
  return new;
end;
$$;

create trigger campaign_creatives_validate_storage_path
  before insert or update of campaign_id, storage_path
  on public.campaign_creatives
  for each row execute function private.validate_campaign_media_path();

create or replace function private.prevent_active_campaign_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_campaign_id uuid;
  target_campaign_id uuid;
begin
  source_campaign_id := old.campaign_id;
  target_campaign_id := case when tg_op = 'UPDATE' then new.campaign_id end;

  if exists (
    select 1 from public.campaigns
    where id = source_campaign_id and status = 'active'
  ) and not private.campaign_is_structurally_ready(source_campaign_id) then
    raise exception using
      errcode = '23514',
      message = 'An active campaign cannot lose its required structure.';
  end if;

  if target_campaign_id is distinct from source_campaign_id
     and exists (
       select 1 from public.campaigns
       where id = target_campaign_id and status = 'active'
     )
     and not private.campaign_is_structurally_ready(target_campaign_id) then
    raise exception using
      errcode = '23514',
      message = 'An active campaign cannot lose its required structure.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create constraint trigger campaign_creatives_preserve_active_readiness
  after update or delete on public.campaign_creatives
  deferrable initially immediate
  for each row execute function private.prevent_active_campaign_invalidation();

create constraint trigger campaign_geofences_preserve_active_readiness
  after update or delete on public.campaign_geofences
  deferrable initially immediate
  for each row execute function private.prevent_active_campaign_invalidation();

create index campaign_creatives_active_campaign_idx
  on public.campaign_creatives (campaign_id)
  where active;
create index campaign_geofences_active_campaign_idx
  on public.campaign_geofences (campaign_id)
  where active;

create view public.campaign_admin_view
with (security_invoker = true)
as
select
  c.*,
  a.trade_name as advertiser_name,
  (select count(*)::integer
   from public.campaign_creatives cc
   where cc.campaign_id = c.id and cc.active) as creative_count,
  (select count(*)::integer
   from public.campaign_geofences cg
   where cg.campaign_id = c.id and cg.active) as geofence_count,
  (select count(*)::bigint
   from public.impressions i
   where i.campaign_id = c.id) as impression_count
from public.campaigns c
left join public.advertisers a on a.id = c.advertiser_id;

create view public.campaign_geofence_admin_view
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
  cg.updated_at
from public.campaign_geofences cg
join public.campaigns c on c.id = cg.campaign_id
join public.establishments e on e.id = cg.establishment_id
left join public.advertisers a on a.id = c.advertiser_id;

revoke all on public.campaign_admin_view from public, anon;
revoke all on public.campaign_geofence_admin_view from public, anon;
grant select on public.campaign_admin_view to authenticated;
grant select on public.campaign_geofence_admin_view to authenticated;

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
    cg.radius_meters,
    measured.distance <= cg.radius_meters,
    (
      measured.distance <= cg.radius_meters
      and cg.active
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
  join public.campaigns c on c.id = cg.campaign_id
  join public.establishments e on e.id = cg.establishment_id
  cross join lateral (
    select extensions.st_distance(e.location, vehicle_point) as distance
  ) measured
  where cg.id = p_geofence_id;
end;
$$;

revoke all on function public.simulate_geofence_eligibility(
  uuid, double precision, double precision, timestamptz, text
) from public, anon;
grant execute on function public.simulate_geofence_eligibility(
  uuid, double precision, double precision, timestamptz, text
) to authenticated;

create or replace function private.can_access_campaign_media(
  p_object_name text,
  p_write_access boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_advertiser_id uuid;
  path_campaign_id uuid;
  app_role_value public.app_role;
  current_advertiser_id uuid;
begin
  if p_object_name !~ '^advertisers/[0-9a-f-]{36}/campaigns/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$' then
    return false;
  end if;

  path_parts := string_to_array(p_object_name, '/');
  path_advertiser_id := path_parts[2]::uuid;
  path_campaign_id := path_parts[4]::uuid;

  app_role_value := private.current_app_role();
  current_advertiser_id := private.current_advertiser_id();

  if p_write_access
     and app_role_value not in ('super_admin', 'admin', 'commercial') then
    return false;
  end if;
  if not p_write_access
     and app_role_value not in (
       'super_admin', 'admin', 'commercial', 'operations', 'advertiser'
     ) then
    return false;
  end if;
  if app_role_value = 'advertiser'
     and current_advertiser_id <> path_advertiser_id then
    return false;
  end if;

  return exists (
    select 1 from public.campaigns c
    where c.id = path_campaign_id
      and c.advertiser_id = path_advertiser_id
      and (
        app_role_value in ('super_admin', 'admin', 'commercial', 'operations')
        or c.advertiser_id = current_advertiser_id
      )
  );
exception
  when invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.campaign_is_structurally_ready(uuid) from public, anon;
revoke all on function private.can_access_campaign_media(text, boolean) from public, anon;
grant execute on function private.campaign_is_structurally_ready(uuid) to authenticated;
grant execute on function private.can_access_campaign_media(text, boolean) to authenticated;

update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'
    ]
where id = 'campaign-media';

alter table storage.objects enable row level security;
revoke all on storage.objects from anon;
grant select, insert on storage.objects to authenticated;

create policy campaign_media_authenticated_read
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-media'
  and private.can_access_campaign_media(name, false)
);

create policy campaign_media_commercial_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'campaign-media'
  and private.can_access_campaign_media(name, true)
);

comment on function private.campaign_is_structurally_ready(uuid) is
  'Database authority for active campaign structure: schedule, creative and GEO geofence.';
comment on function public.simulate_geofence_eligibility(
  uuid, double precision, double precision, timestamptz, text
) is 'RLS-aware PostGIS proximity simulation for one administrative geofence.';
comment on function private.can_access_campaign_media(text, boolean) is
  'Validates private campaign-media paths against auth.uid(), role and campaign ownership.';
