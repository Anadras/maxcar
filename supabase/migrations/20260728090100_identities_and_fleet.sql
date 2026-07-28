-- MAX-002: advertisers, drivers, profiles, establishments, vehicles and devices.

create table public.advertisers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null,
  document_number text,
  contact_name text,
  contact_email text,
  contact_phone text,
  status public.advertiser_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertisers_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint advertisers_trade_name_not_blank check (btrim(trade_name) <> '')
);

create unique index advertisers_document_number_unique
  on public.advertisers (document_number)
  where document_number is not null;
create index advertisers_status_idx on public.advertisers (status);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text,
  phone text,
  email text,
  status public.driver_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drivers_full_name_not_blank check (btrim(full_name) <> '')
);

create unique index drivers_document_number_unique
  on public.drivers (document_number)
  where document_number is not null;
create unique index drivers_email_unique
  on public.drivers (lower(email))
  where email is not null;
create index drivers_status_idx on public.drivers (status);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role public.app_role not null default 'pending',
  advertiser_id uuid references public.advertisers (id) on delete set null,
  driver_id uuid references public.drivers (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_binding_check check (
    (role = 'advertiser' and advertiser_id is not null and driver_id is null)
    or (role = 'driver' and driver_id is not null and advertiser_id is null)
    or (role not in ('advertiser', 'driver') and advertiser_id is null and driver_id is null)
  )
);

create index profiles_advertiser_id_idx
  on public.profiles (advertiser_id)
  where advertiser_id is not null;
create unique index profiles_driver_user_unique
  on public.profiles (driver_id)
  where driver_id is not null;
create index profiles_role_idx on public.profiles (role);

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
  );
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  name text not null,
  address_line text not null,
  number text,
  complement text,
  neighborhood text,
  city text not null,
  state char(2) not null,
  postal_code text,
  location extensions.geography(Point, 4326) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint establishments_name_not_blank check (btrim(name) <> ''),
  constraint establishments_city_not_blank check (btrim(city) <> ''),
  constraint establishments_state_uppercase check (state = upper(state))
);

create index establishments_advertiser_id_idx on public.establishments (advertiser_id);
create index establishments_location_gist_idx on public.establishments using gist (location);
create index establishments_city_state_idx on public.establishments (city, state);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers (id) on delete set null,
  internal_code text not null unique,
  license_plate text,
  make text,
  model text,
  year smallint,
  status public.vehicle_status not null default 'unassigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_internal_code_not_blank check (btrim(internal_code) <> ''),
  constraint vehicles_year_check check (year is null or year between 1980 and 2100)
);

create unique index vehicles_license_plate_unique
  on public.vehicles (upper(license_plate))
  where license_plate is not null;
create index vehicles_driver_id_idx on public.vehicles (driver_id);
create index vehicles_status_idx on public.vehicles (status);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id) on delete set null,
  device_code text not null unique,
  status public.device_status not null default 'provisioning',
  app_version text,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_device_code_not_blank check (btrim(device_code) <> '')
);

create index devices_vehicle_id_idx on public.devices (vehicle_id);
create index devices_status_idx on public.devices (status);
create index devices_last_seen_at_idx on public.devices (last_seen_at desc);

create trigger advertisers_set_updated_at before update on public.advertisers
  for each row execute function public.set_updated_at();
create trigger drivers_set_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger establishments_set_updated_at before update on public.establishments
  for each row execute function public.set_updated_at();
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();
create trigger devices_set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();

comment on column public.establishments.location is
  'WGS84 geography point used for accurate meter-based terrestrial distance checks.';
comment on table public.devices is
  'Device secrets are intentionally absent; revocable credentials belong to a later security phase.';
