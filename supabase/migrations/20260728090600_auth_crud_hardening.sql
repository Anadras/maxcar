-- MAX-003: tighten profile administration and expose a safe PostGIS write API.

drop policy profiles_admin_write on public.profiles;

create policy profiles_super_admin_write on public.profiles
  for all to authenticated
  using (private.current_app_role() = 'super_admin')
  with check (private.current_app_role() = 'super_admin');

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (
    private.current_app_role() = 'admin'
    and role <> 'super_admin'
    and id <> auth.uid()
  )
  with check (
    private.current_app_role() = 'admin'
    and role <> 'super_admin'
    and id <> auth.uid()
  );

create or replace function public.save_establishment(
  p_id uuid,
  p_advertiser_id uuid,
  p_name text,
  p_address_line text,
  p_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_latitude double precision,
  p_longitude double precision,
  p_active boolean
)
returns public.establishments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.establishments;
  point extensions.geography(Point, 4326);
begin
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using
      errcode = '22023',
      message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using
      errcode = '22023',
      message = 'Longitude must be between -180 and 180.';
  end if;

  point := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  if p_id is null then
    insert into public.establishments (
      advertiser_id, name, address_line, number, complement, neighborhood,
      city, state, postal_code, location, active
    )
    values (
      p_advertiser_id, btrim(p_name), btrim(p_address_line),
      nullif(btrim(p_number), ''), nullif(btrim(p_complement), ''),
      nullif(btrim(p_neighborhood), ''), btrim(p_city), upper(btrim(p_state)),
      nullif(btrim(p_postal_code), ''), point, p_active
    )
    returning * into saved;
  else
    update public.establishments
    set advertiser_id = p_advertiser_id,
        name = btrim(p_name),
        address_line = btrim(p_address_line),
        number = nullif(btrim(p_number), ''),
        complement = nullif(btrim(p_complement), ''),
        neighborhood = nullif(btrim(p_neighborhood), ''),
        city = btrim(p_city),
        state = upper(btrim(p_state)),
        postal_code = nullif(btrim(p_postal_code), ''),
        location = point,
        active = p_active
    where id = p_id
    returning * into saved;

    if saved.id is null then
      raise exception using errcode = 'P0002', message = 'Establishment not found.';
    end if;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_establishment(
  uuid, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, boolean
) from public, anon;
grant execute on function public.save_establishment(
  uuid, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, boolean
) to authenticated;

create view public.establishment_admin_view
with (security_invoker = true)
as
select
  e.id,
  e.advertiser_id,
  a.trade_name as advertiser_name,
  e.name,
  e.address_line,
  e.number,
  e.complement,
  e.neighborhood,
  e.city,
  e.state,
  e.postal_code,
  extensions.st_y(e.location::extensions.geometry) as latitude,
  extensions.st_x(e.location::extensions.geometry) as longitude,
  e.active,
  e.created_at,
  e.updated_at
from public.establishments e
left join public.advertisers a on a.id = e.advertiser_id;

revoke all on public.establishment_admin_view from public, anon;
grant select on public.establishment_admin_view to authenticated;

comment on function public.save_establishment(
  uuid, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, boolean
) is 'RLS-protected establishment upsert that constructs a WGS84 geography point server-side.';
comment on view public.establishment_admin_view is
  'RLS-aware establishment projection with latitude and longitude for the admin application.';

create or replace function public.update_own_profile_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 120 then
    raise exception using errcode = '22023', message = 'Invalid full name.';
  end if;

  update public.profiles
  set full_name = btrim(p_full_name)
  where id = auth.uid();
end;
$$;

revoke all on function public.update_own_profile_name(text) from public, anon;
grant execute on function public.update_own_profile_name(text) to authenticated;

comment on function public.update_own_profile_name(text) is
  'Updates only the authenticated user display name without exposing privileged profile columns.';
