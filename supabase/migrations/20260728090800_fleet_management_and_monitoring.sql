-- MAX-005: fleet integrity, RLS-aware monitoring and a safe development heartbeat.

create unique index vehicles_one_driver_unique
  on public.vehicles (driver_id)
  where driver_id is not null;

create unique index devices_one_vehicle_unique
  on public.devices (vehicle_id)
  where vehicle_id is not null;

create or replace function public.normalize_vehicle_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.internal_code := upper(btrim(new.internal_code));
  new.license_plate := nullif(
    upper(pg_catalog.regexp_replace(coalesce(new.license_plate, ''), '[^A-Za-z0-9]', '', 'g')),
    ''
  );
  if new.license_plate is not null
     and new.license_plate !~ '^[A-Z]{3}([0-9]{4}|[0-9][A-Z][0-9]{2})$' then
    raise exception using errcode = '22023', message = 'Invalid Brazilian license plate.';
  end if;
  return new;
end;
$$;

create trigger vehicles_normalize_fields
  before insert or update of internal_code, license_plate on public.vehicles
  for each row execute function public.normalize_vehicle_fields();

create or replace function public.normalize_device_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.device_code := upper(btrim(new.device_code));
  return new;
end;
$$;

create trigger devices_normalize_code
  before insert or update of device_code on public.devices
  for each row execute function public.normalize_device_code();

create policy device_heartbeats_super_admin_insert
  on public.device_heartbeats
  for insert to authenticated
  with check (private.current_app_role() = 'super_admin');

create or replace function public.simulate_device_heartbeat(
  p_device_id uuid,
  p_battery_level smallint default 85,
  p_network_connected boolean default true,
  p_gps_available boolean default true,
  p_storage_free_bytes bigint default 16000000000,
  p_app_version text default '1.0.0-dev',
  p_latitude double precision default -20.4697,
  p_longitude double precision default -54.6201
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  heartbeat_id uuid;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Super admin required.';
  end if;
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using errcode = '22023', message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = '22023', message = 'Longitude must be between -180 and 180.';
  end if;

  insert into public.device_heartbeats (
    device_id, recorded_at, battery_level, network_connected, gps_available,
    storage_free_bytes, app_version, location
  ) values (
    p_device_id, now(), p_battery_level, p_network_connected, p_gps_available,
    p_storage_free_bytes, nullif(btrim(p_app_version), ''),
    extensions.st_setsrid(
      extensions.st_makepoint(p_longitude, p_latitude), 4326
    )::extensions.geography
  )
  returning id into heartbeat_id;

  update public.devices
  set last_seen_at = now(),
      app_version = coalesce(nullif(btrim(p_app_version), ''), app_version)
  where id = p_device_id;

  return heartbeat_id;
end;
$$;

revoke all on function public.simulate_device_heartbeat(
  uuid, smallint, boolean, boolean, bigint, text, double precision, double precision
) from public, anon;
grant execute on function public.simulate_device_heartbeat(
  uuid, smallint, boolean, boolean, bigint, text, double precision, double precision
) to authenticated;

create view public.driver_admin_view
with (security_invoker = true)
as
select
  d.*,
  v.id as vehicle_id,
  v.internal_code as vehicle_code,
  v.license_plate
from public.drivers d
left join public.vehicles v on v.driver_id = d.id;

create view public.vehicle_admin_view
with (security_invoker = true)
as
select
  v.*,
  d.full_name as driver_name,
  dv.id as device_id,
  dv.device_code
from public.vehicles v
left join public.drivers d on d.id = v.driver_id
left join public.devices dv on dv.vehicle_id = v.id;

create view public.device_monitoring_view
with (security_invoker = true)
as
select
  dv.*,
  v.internal_code as vehicle_code,
  v.license_plate,
  d.id as driver_id,
  d.full_name as driver_name,
  hb.recorded_at as heartbeat_at,
  hb.battery_level,
  hb.network_connected,
  hb.gps_available,
  hb.storage_free_bytes,
  hb.app_version as heartbeat_app_version,
  extensions.st_y(hb.location::extensions.geometry) as latitude,
  extensions.st_x(hb.location::extensions.geometry) as longitude
from public.devices dv
left join public.vehicles v on v.id = dv.vehicle_id
left join public.drivers d on d.id = v.driver_id
left join lateral (
  select h.*
  from public.device_heartbeats h
  where h.device_id = dv.id
  order by h.recorded_at desc
  limit 1
) hb on true;

revoke all on public.driver_admin_view from public, anon;
revoke all on public.vehicle_admin_view from public, anon;
revoke all on public.device_monitoring_view from public, anon;
grant select on public.driver_admin_view to authenticated;
grant select on public.vehicle_admin_view to authenticated;
grant select on public.device_monitoring_view to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter function public.handle_new_auth_user() owner to postgres;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on view public.device_monitoring_view is
  'RLS-aware fleet projection containing only the latest heartbeat for each device.';
comment on function public.simulate_device_heartbeat(
  uuid, smallint, boolean, boolean, bigint, text, double precision, double precision
) is 'Super-admin-only heartbeat helper intended for local development validation.';
