-- MAX-011 Bloco D: "Testar campanha GEO neste dispositivo" — a super_admin
-- tool that answers "would this device receive this GEO rule right now"
-- without needing the device's own credential (never exposed to the
-- panel) and without touching the real tablet. Reuses the exact same
-- eligibility predicate as get_device_geo_rules so the answer can never
-- drift from what the tablet actually gets; only the distance-to-radius
-- comparison is added, using the device's last reported heartbeat
-- location. Always clearly a simulation — the caller's UI is responsible
-- for labeling it as such, per the mandate ("marcado como simulado").
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
        'latitude', extensions.st_y(e.location::extensions.geometry),
        'longitude', extensions.st_x(e.location::extensions.geometry),
        'radiusMeters', cg.radius_meters,
        'geofenceActive', cg.active,
        'establishmentActive', e.active,
        'distanceMeters', case
          when v_device_location is null then null
          else round(extensions.st_distance(e.location, v_device_location)::numeric, 1)
        end,
        'insideRadius', case
          when v_device_location is null then null
          else extensions.st_distance(e.location, v_device_location) <= cg.radius_meters
        end
      ) as item
    from public.campaign_geofences cg
    join public.establishments e on e.id = cg.establishment_id
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

revoke all on function public.test_geo_campaign_delivery(uuid, uuid) from public, anon;
grant execute on function public.test_geo_campaign_delivery(uuid, uuid) to authenticated;

comment on function public.test_geo_campaign_delivery(uuid, uuid) is
  'Super_admin-only simulation: evaluates the same eligibility predicate get_device_geo_rules uses for a given device/campaign pair, using the device''s last known heartbeat location for the distance check. Never reads or requires a device credential.';
