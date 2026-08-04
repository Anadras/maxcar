-- Pilot-mode administration: the super administrator may permanently remove
-- test data and its operational descendants, while every deletion leaves an
-- immutable, non-sensitive audit event. Turning pilot_mode off restores the
-- conservative production restrictions in the existing lifecycle functions.

create table public.system_settings (
  singleton boolean primary key default true check (singleton),
  pilot_mode boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.system_settings (singleton, pilot_mode) values (true, true);

alter table public.system_settings enable row level security;
revoke all on public.system_settings from public, anon, authenticated;
create policy system_settings_staff_select on public.system_settings
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations'));
grant select on public.system_settings to authenticated;

alter table public.audit_events drop constraint audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
  check (entity_type in ('advertiser', 'establishment', 'campaign', 'driver', 'vehicle', 'device'));

create or replace function private.require_pilot_super_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can permanently delete records.';
  end if;
  if not coalesce((select pilot_mode from public.system_settings where singleton), false) then
    raise exception using errcode = '42501', message = 'Permanent test-data deletion is disabled outside pilot mode.';
  end if;
end;
$$;
revoke all on function private.require_pilot_super_admin() from public, anon, authenticated;

create or replace function public.delete_driver_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.drivers%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.drivers where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Driver not found.'; end if;
  delete from public.driver_sessions where driver_id = p_id;
  update public.vehicles set driver_id = null where driver_id = p_id;
  delete from public.drivers where id = p_id;
  perform private.record_audit_event('delete', 'driver', p_id, v_row.full_name, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

create or replace function public.delete_vehicle_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.vehicles%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Vehicle not found.'; end if;
  delete from public.driver_sessions where vehicle_id = p_id;
  update public.devices set vehicle_id = null where vehicle_id = p_id;
  delete from public.vehicles where id = p_id;
  perform private.record_audit_event('delete', 'vehicle', p_id, v_row.internal_code, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

create or replace function public.delete_device_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.devices%rowtype; v_snapshot jsonb;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Device not found.'; end if;
  v_snapshot := to_jsonb(v_row) - 'maintenance_pin_hash' - 'maintenance_pin_salt';
  delete from public.geofence_events where device_id = p_id;
  delete from public.impressions where device_id = p_id;
  delete from public.device_heartbeats where device_id = p_id;
  update public.driver_sessions set device_id = null where device_id = p_id;
  delete from public.playlist_items where playlist_id in (select id from public.playlists where device_id = p_id);
  delete from public.playlists where device_id = p_id;
  delete from public.devices where id = p_id;
  perform private.record_audit_event('delete', 'device', p_id, v_row.device_code, p_reason, v_snapshot, jsonb_build_object('pilotMode', true));
end; $$;

create or replace function public.delete_campaign_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.campaigns%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.campaigns where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Campaign not found.'; end if;
  update public.campaigns set status = 'cancelled' where id = p_id;
  delete from public.geofence_events where campaign_geofence_id in (select id from public.campaign_geofences where campaign_id = p_id);
  delete from public.impressions where campaign_id = p_id;
  delete from public.playlist_items where campaign_id = p_id;
  delete from public.campaign_geofences where campaign_id = p_id;
  delete from public.campaign_creatives where campaign_id = p_id;
  delete from public.campaigns where id = p_id;
  perform private.record_audit_event('delete', 'campaign', p_id, v_row.name, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

create or replace function public.delete_establishment_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.establishments%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.establishments where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Establishment not found.'; end if;
  update public.campaigns set status = 'paused'
    where id in (select campaign_id from public.campaign_geofences where establishment_id = p_id)
      and status = 'active';
  delete from public.geofence_events where campaign_geofence_id in (select id from public.campaign_geofences where establishment_id = p_id);
  delete from public.campaign_geofences where establishment_id = p_id;
  delete from public.establishments where id = p_id;
  perform private.record_audit_event('delete', 'establishment', p_id, v_row.name, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

create or replace function public.delete_advertiser_permanently(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.advertisers%rowtype;
begin
  perform private.require_pilot_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception using errcode = '22023', message = 'A reason is required.'; end if;
  select * into v_row from public.advertisers where id = p_id;
  if v_row.id is null then raise exception using errcode = '22023', message = 'Advertiser not found.'; end if;
  update public.campaigns set status = 'cancelled' where advertiser_id = p_id;
  delete from public.geofence_events where campaign_geofence_id in (
    select cg.id from public.campaign_geofences cg join public.campaigns c on c.id = cg.campaign_id where c.advertiser_id = p_id
  );
  delete from public.impressions where campaign_id in (select id from public.campaigns where advertiser_id = p_id);
  delete from public.playlist_items where campaign_id in (select id from public.campaigns where advertiser_id = p_id);
  delete from public.campaign_geofences where campaign_id in (select id from public.campaigns where advertiser_id = p_id);
  delete from public.campaign_creatives where campaign_id in (select id from public.campaigns where advertiser_id = p_id);
  delete from public.campaigns where advertiser_id = p_id;
  delete from public.establishments where advertiser_id = p_id;
  delete from public.advertisers where id = p_id;
  perform private.record_audit_event('delete', 'advertiser', p_id, v_row.trade_name, p_reason, to_jsonb(v_row), jsonb_build_object('pilotMode', true));
end; $$;

revoke all on function public.delete_campaign_permanently(uuid, text) from public, anon;
revoke all on function public.delete_establishment_permanently(uuid, text) from public, anon;
revoke all on function public.delete_advertiser_permanently(uuid, text) from public, anon;
grant execute on function public.delete_campaign_permanently(uuid, text) to authenticated;
grant execute on function public.delete_establishment_permanently(uuid, text) to authenticated;
grant execute on function public.delete_advertiser_permanently(uuid, text) to authenticated;

-- The application removes the private binary first, then calls the audited
-- database deletion. The path policy still derives ownership from campaign.
grant delete on storage.objects to authenticated;
create policy campaign_media_commercial_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-media' and private.can_access_campaign_media(name, true));

comment on table public.system_settings is
  'Singleton operational switches. pilot_mode explicitly allows audited deletion of test data; it must be disabled before commercial operation.';
