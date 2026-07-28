-- MAX-002: authorization helpers and row-level access policies.
-- Helpers are SECURITY DEFINER only to avoid recursive profile RLS. They expose
-- the minimum current-user attributes and pin search_path to prevent hijacking.

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = auth.uid() and active
  limit 1
$$;

create or replace function private.current_advertiser_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select advertiser_id
  from public.profiles
  where id = auth.uid() and active and role = 'advertiser'
  limit 1
$$;

create or replace function private.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select driver_id
  from public.profiles
  where id = auth.uid() and active and role = 'driver'
  limit 1
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() in ('super_admin', 'admin'), false)
$$;

revoke all on function private.current_app_role() from public, anon;
revoke all on function private.current_advertiser_id() from public, anon;
revoke all on function private.current_driver_id() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.current_advertiser_id() to authenticated;
grant execute on function private.current_driver_id() to authenticated;
grant execute on function private.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.advertisers enable row level security;
alter table public.establishments enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.devices enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_creatives enable row level security;
alter table public.campaign_geofences enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
alter table public.geofence_events enable row level security;
alter table public.impressions enable row level security;
alter table public.device_heartbeats enable row level security;
alter table public.driver_sessions enable row level security;

-- Profiles: every user can read the minimum own profile, while only admins can
-- change role, binding or active state.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.is_admin());
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Commercial domain.
create policy advertisers_select on public.advertisers
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial')
    or id = private.current_advertiser_id()
  );
create policy advertisers_staff_write on public.advertisers
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy advertisers_owner_update on public.advertisers
  for update to authenticated
  using (id = private.current_advertiser_id())
  with check (id = private.current_advertiser_id());

create policy establishments_select on public.establishments
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or advertiser_id = private.current_advertiser_id()
  );
create policy establishments_staff_write on public.establishments
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy establishments_advertiser_insert on public.establishments
  for insert to authenticated
  with check (advertiser_id = private.current_advertiser_id());
create policy establishments_advertiser_update on public.establishments
  for update to authenticated
  using (advertiser_id = private.current_advertiser_id())
  with check (advertiser_id = private.current_advertiser_id());

create policy campaigns_select on public.campaigns
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or advertiser_id = private.current_advertiser_id()
  );
create policy campaigns_staff_write on public.campaigns
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy campaigns_advertiser_insert on public.campaigns
  for insert to authenticated
  with check (advertiser_id = private.current_advertiser_id());
create policy campaigns_advertiser_update on public.campaigns
  for update to authenticated
  using (advertiser_id = private.current_advertiser_id())
  with check (advertiser_id = private.current_advertiser_id());

create policy campaign_creatives_select on public.campaign_creatives
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );
create policy campaign_creatives_staff_write on public.campaign_creatives
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy campaign_creatives_advertiser_insert on public.campaign_creatives
  for insert to authenticated
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );
create policy campaign_creatives_advertiser_update on public.campaign_creatives
  for update to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );

create policy campaign_geofences_select on public.campaign_geofences
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );
create policy campaign_geofences_staff_write on public.campaign_geofences
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'commercial'));
create policy campaign_geofences_advertiser_insert on public.campaign_geofences
  for insert to authenticated
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );
create policy campaign_geofences_advertiser_update on public.campaign_geofences
  for update to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
  );

-- Fleet and operational domain.
create policy drivers_select on public.drivers
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or id = private.current_driver_id()
  );
create policy drivers_staff_write on public.drivers
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

create policy vehicles_select on public.vehicles
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or driver_id = private.current_driver_id()
  );
create policy vehicles_staff_write on public.vehicles
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

create policy devices_select on public.devices
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id and v.driver_id = private.current_driver_id()
    )
  );
create policy devices_staff_write on public.devices
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

create policy playlists_select on public.playlists
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations'));
create policy playlists_staff_write on public.playlists
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

create policy playlist_items_select on public.playlist_items
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations'));
create policy playlist_items_staff_write on public.playlist_items
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

create policy geofence_events_select on public.geofence_events
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or exists (
      select 1
      from public.devices d
      join public.vehicles v on v.id = d.vehicle_id
      where d.id = device_id and v.driver_id = private.current_driver_id()
    )
  );

create policy impressions_select on public.impressions
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations')
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.advertiser_id = private.current_advertiser_id()
    )
    or exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id and v.driver_id = private.current_driver_id()
    )
  );

create policy device_heartbeats_select on public.device_heartbeats
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or exists (
      select 1
      from public.devices d
      join public.vehicles v on v.id = d.vehicle_id
      where d.id = device_id and v.driver_id = private.current_driver_id()
    )
  );

create policy driver_sessions_select on public.driver_sessions
  for select to authenticated
  using (
    private.current_app_role() in ('super_admin', 'admin', 'operations')
    or driver_id = private.current_driver_id()
  );
create policy driver_sessions_staff_write on public.driver_sessions
  for all to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'))
  with check (private.current_app_role() in ('super_admin', 'admin', 'operations'));

-- PostgREST privileges are explicit; policies still determine each visible row.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

comment on function private.current_app_role() is
  'Trusted role lookup based only on auth.uid(); never accepts a client-supplied role.';
