-- MAX-011 Bloco C: lets an operator pick exactly which tablets a campaign
-- reaches, for REGULAR and GEO alike — today neither has any per-device
-- restriction: REGULAR relies entirely on the playlist/device_id concept
-- (MAX-007) and GEO has no device targeting whatsoever.
--
-- Deliberately additive, not a replacement for playlists: an empty
-- campaign_devices set for a campaign means "no restriction" (the existing
-- playlist/global-default behavior for REGULAR, or "every device with a
-- matching geofence" for GEO) — exactly today's behavior, so every
-- already-running pilot campaign keeps working unchanged. Only once a row
-- exists does a campaign become restricted to that allowlist. This is why
-- a new table, not a reuse of playlists: GEO campaigns were never part of
-- the playlist concept (playlist_items_validate_campaign_type explicitly
-- forbids it, MAX-007), and forcing GEO into that shape to get per-device
-- targeting would blend two concepts that only look similar.

create table public.campaign_devices (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users (id) on delete set null,
  constraint campaign_devices_unique unique (campaign_id, device_id)
);

create index campaign_devices_campaign_id_idx on public.campaign_devices (campaign_id);
create index campaign_devices_device_id_idx on public.campaign_devices (device_id);

alter table public.campaign_devices enable row level security;
revoke all on public.campaign_devices from public, anon, authenticated;

create policy campaign_devices_staff_select on public.campaign_devices
  for select to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'commercial', 'operations'));
grant select on public.campaign_devices to authenticated;

-- Replaces a campaign's entire device allowlist atomically — the panel's
-- "Dispositivos desta campanha" always saves the full selected set, never
-- one row at a time, so a full replace (rather than incremental add/remove
-- RPCs) matches how the UI actually calls this and avoids any window where
-- a half-applied selection is live.
create or replace function public.set_campaign_devices(
  p_campaign_id uuid,
  p_device_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_fleet_manager();

  if not exists (select 1 from public.campaigns where id = p_campaign_id) then
    raise exception using errcode = '22023', message = 'Campaign not found.';
  end if;
  if p_device_ids is not null and exists (
    select 1 from unnest(p_device_ids) as d(id)
    where not exists (select 1 from public.devices where devices.id = d.id)
  ) then
    raise exception using errcode = '22023', message = 'One or more devices were not found.';
  end if;

  delete from public.campaign_devices where campaign_id = p_campaign_id;

  if p_device_ids is not null and cardinality(p_device_ids) > 0 then
    insert into public.campaign_devices (campaign_id, device_id, assigned_by)
    select p_campaign_id, d.id, auth.uid()
    from unnest(p_device_ids) as d(id);
  end if;
end;
$$;

revoke all on function public.set_campaign_devices(uuid, uuid[]) from public, anon;
grant execute on function public.set_campaign_devices(uuid, uuid[]) to authenticated;

-- REGULAR manifest: unchanged for any campaign with no campaign_devices
-- rows; restricted to the allowlist once one exists.
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
      and (
        not exists (select 1 from public.campaign_devices cd where cd.campaign_id = c.id)
        or exists (
          select 1 from public.campaign_devices cd
          where cd.campaign_id = c.id and cd.device_id = v_device_id
        )
      )
  ) entry;

  return jsonb_build_object(
    'manifestVersion', coalesce(v_version, '0'),
    'generatedAt', now(),
    'deviceId', v_device_id,
    'playlist', v_items
  );
end;
$$;

-- GEO rules: same allowlist rule, so an operator can restrict a GEO
-- campaign to specific tablets even though it has no playlist concept.
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
      and (
        not exists (select 1 from public.campaign_devices cd where cd.campaign_id = c.id)
        or exists (
          select 1 from public.campaign_devices cd
          where cd.campaign_id = c.id and cd.device_id = v_device_id
        )
      )
  ) entry;

  return jsonb_build_object(
    'rulesVersion', coalesce(v_version, '0'),
    'generatedAt', now(),
    'deviceId', v_device_id,
    'rules', v_rules
  );
end;
$$;

revoke all on function public.get_device_manifest(text) from public, anon, authenticated;
grant execute on function public.get_device_manifest(text) to service_role;
revoke all on function public.get_device_geo_rules(text) from public, anon, authenticated;
grant execute on function public.get_device_geo_rules(text) to service_role;

-- Panel-facing view: which devices see a given campaign right now, plus
-- their fleet context and last sync — the "Dispositivos desta campanha"
-- table reads this directly instead of joining devices/vehicles/drivers/
-- heartbeats itself.
create view public.campaign_device_admin_view
with (security_invoker = true)
as
select
  c.id as campaign_id,
  d.id as device_id,
  d.device_code,
  d.status as device_status,
  d.archived_at as device_archived_at,
  v.id as vehicle_id,
  v.internal_code as vehicle_code,
  dr.full_name as driver_name,
  cd.assigned_at,
  (cd.campaign_id is not null) as explicitly_assigned
from public.campaigns c
cross join public.devices d
left join public.vehicles v on v.id = d.vehicle_id
left join public.drivers dr on dr.id = v.driver_id
left join public.campaign_devices cd
  on cd.campaign_id = c.id and cd.device_id = d.id;

revoke all on public.campaign_device_admin_view from public, anon;
grant select on public.campaign_device_admin_view to authenticated;

comment on table public.campaign_devices is
  'Explicit per-device allowlist for a campaign. Empty for a campaign = unrestricted (existing playlist/geofence behavior); one or more rows = only those devices ever receive it, REGULAR or GEO alike.';
comment on function public.set_campaign_devices(uuid, uuid[]) is
  'Full-replace of a campaign''s device allowlist; pass an empty array to remove all restriction.';
