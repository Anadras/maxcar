-- MAX-014 items 6-7: remote APK updates + their server-side counterpart to
-- "rollback lógico" — publishing a release is a super_admin-only, audited
-- action (this pushes code to a fleet of Device-Owner-locked kiosks; the
-- blast radius is the same category as the maintenance PIN, not a normal
-- CRUD write), and an already-published release can be deactivated
-- without deleting its history if it turns out to be bad.
--
-- Single 'staging' channel hardcoded throughout, matching this pilot's
-- actual single-environment reality (1 device, staging build) — not a
-- general multi-channel rollout system. A real production channel is a
-- follow-up, not something to speculatively build now.

create table public.apk_releases (
  id uuid primary key default gen_random_uuid(),
  version_code integer not null,
  version_name text not null,
  channel text not null default 'staging' check (channel in ('staging', 'production')),
  storage_path text not null,
  sha256 text not null,
  file_size_bytes bigint not null,
  release_notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint apk_releases_version_code_channel_unique unique (version_code, channel),
  constraint apk_releases_version_code_positive check (version_code > 0),
  constraint apk_releases_sha256_format check (sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.apk_releases is
  'Published APK builds a device can be offered as an OTA update. Never deleted — a bad release is deactivated (active = false), keeping full history for audit.';

create index apk_releases_channel_active_idx
  on public.apk_releases (channel, active, version_code desc);

alter table public.apk_releases enable row level security;
grant select on public.apk_releases to authenticated;

create policy apk_releases_staff_select
  on public.apk_releases
  for select
  to authenticated
  using (private.current_app_role() in ('super_admin', 'admin', 'operations'));

-- Publishing a build is deliberately narrower than the usual fleet-manager
-- write gate (private.require_fleet_manager, which includes commercial/
-- operations for campaign work) — this is code shipped to Device-Owner
-- kiosks, the same trust tier as the maintenance PIN.
create or replace function public.publish_apk_release(
  p_version_code integer,
  p_version_name text,
  p_storage_path text,
  p_sha256 text,
  p_file_size_bytes bigint,
  p_release_notes text default null,
  p_channel text default 'staging'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can publish an APK release.';
  end if;

  insert into public.apk_releases (
    version_code, version_name, channel, storage_path, sha256, file_size_bytes, release_notes, created_by
  ) values (
    p_version_code, p_version_name, p_channel, p_storage_path, p_sha256, p_file_size_bytes, p_release_notes, auth.uid()
  )
  returning id into v_id;

  perform private.record_audit_event(
    'publish_apk_release', 'apk_release', v_id, p_version_name,
    p_release_notes, null,
    jsonb_build_object('version_code', p_version_code, 'channel', p_channel, 'sha256', p_sha256)
  );

  return v_id;
end;
$$;

revoke all on function public.publish_apk_release(integer, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.publish_apk_release(integer, text, text, text, bigint, text, text) to authenticated;

-- The server-side half of "rollback lógico" (item 7): stop offering a
-- release that turns out to be bad, without losing its history. Devices
-- that already applied it rely on their own local client-side rollback
-- (see ApkUpdateManager on Android) — this only affects what's offered to
-- devices that haven't updated yet.
create or replace function public.set_apk_release_active(p_release_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_name text;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can change an APK release''s availability.';
  end if;

  select version_name into v_version_name from public.apk_releases where id = p_release_id;
  if v_version_name is null then
    raise exception using errcode = '22023', message = 'Release not found.';
  end if;

  update public.apk_releases set active = p_active where id = p_release_id;

  perform private.record_audit_event(
    case when p_active then 'reactivate_apk_release' else 'deactivate_apk_release' end,
    'apk_release', p_release_id, v_version_name, null, null, '{}'::jsonb
  );
end;
$$;

revoke all on function public.set_apk_release_active(uuid, boolean) from public, anon;
grant execute on function public.set_apk_release_active(uuid, boolean) to authenticated;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in (
    'archive', 'restore', 'deactivate', 'reactivate', 'unlink', 'delete',
    'set_maintenance_pin', 'set_maintenance_timeout', 'generate_maintenance_temp_code',
    'publish_apk_release', 'deactivate_apk_release', 'reactivate_apk_release'
  )
);

alter table public.audit_events drop constraint audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
  check (entity_type in ('advertiser', 'establishment', 'campaign', 'driver', 'vehicle', 'device', 'apk_release'));

-- ==================================================================
-- Storage: a dedicated private bucket for APK binaries — never the
-- campaign-media bucket (different content, different access policy:
-- staff-only, never advertiser-readable, no image/video mime types).
-- ==================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-releases',
  'app-releases',
  false,
  157286400, -- 150 MB — this app's real APKs run ~45-50MB; generous headroom.
  array['application/vnd.android.package-archive']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects was already enabled by
-- 20260728090700_campaign_media_and_geofence_operations.sql — re-running
-- that ALTER here (even though harmless in principle) requires table
-- ownership the migration role doesn't reliably have once it's already
-- enabled, and fails the whole migration. Only new policies are needed.
create policy app_releases_staff_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'app-releases'
  and private.current_app_role() in ('super_admin', 'admin', 'operations')
);

create policy app_releases_super_admin_write
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'app-releases'
  and private.current_app_role() = 'super_admin'
);

-- ==================================================================
-- device-config extension: the latest active release for the device's
-- channel, so the existing periodic config-poll (device-config edge
-- function, already fetched on every configVersion check) doubles as the
-- OTA check with no new polling endpoint or schedule needed.
-- ==================================================================

drop function if exists public.get_device_config(text);

create or replace function public.get_device_config(p_token text)
returns table (
  device_id uuid,
  device_code text,
  vehicle_id uuid,
  vehicle_code text,
  heartbeat_interval_seconds integer,
  sync_interval_seconds integer,
  kiosk_enabled boolean,
  logging_level text,
  config_version integer,
  maintenance_pin_hash text,
  maintenance_pin_salt text,
  maintenance_pin_hash_version integer,
  maintenance_timeout_seconds integer,
  latest_apk_release_id uuid,
  latest_apk_version_code integer,
  latest_apk_version_name text,
  latest_apk_storage_path text,
  latest_apk_sha256 text,
  latest_apk_size_bytes bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
begin
  v_device_id := private.device_id_for_token(p_token);
  return query
  select
    d.id, d.device_code, d.vehicle_id, v.internal_code,
    c.heartbeat_interval_seconds, c.sync_interval_seconds, c.kiosk_enabled,
    c.logging_level, c.config_version,
    d.maintenance_pin_hash, d.maintenance_pin_salt, d.maintenance_pin_hash_version,
    d.maintenance_timeout_seconds,
    r.id, r.version_code, r.version_name, r.storage_path, r.sha256, r.file_size_bytes
  from public.devices d
  left join public.vehicles v on v.id = d.vehicle_id
  cross join public.app_remote_config c
  left join lateral (
    select ar.id, ar.version_code, ar.version_name, ar.storage_path, ar.sha256, ar.file_size_bytes
    from public.apk_releases ar
    where ar.channel = 'staging' and ar.active
    order by ar.version_code desc
    limit 1
  ) r on true
  where d.id = v_device_id;
end;
$$;

revoke all on function public.get_device_config(text) from public, anon, authenticated;
grant execute on function public.get_device_config(text) to service_role;
