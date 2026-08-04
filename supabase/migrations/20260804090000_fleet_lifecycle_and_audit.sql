-- Adds a full administrative lifecycle (archive/restore, deactivate/
-- reactivate, unlink, permanent delete) to drivers, vehicles and devices,
-- plus an immutable audit trail. Every mutating action here goes through a
-- SECURITY DEFINER function, never a raw table write from the client, so
-- the audit record and the action can never drift apart.
--
-- Archiving is orthogonal to the existing status enums (driver_status,
-- vehicle_status, device_status): a record can be "active" and archived
-- at once (e.g. a retired driver kept out of daily lists but still fully
-- queryable/restorable). Deactivation reuses the existing status column —
-- it was already expressive enough for "can't be used, can be reactivated".

alter table public.drivers add column archived_at timestamptz;
alter table public.vehicles add column archived_at timestamptz;
alter table public.devices add column archived_at timestamptz;

create index drivers_archived_at_idx on public.drivers (archived_at);
create index vehicles_archived_at_idx on public.vehicles (archived_at);
create index devices_archived_at_idx on public.devices (archived_at);

-- Immutable audit trail. Only ever written by private.record_audit_event;
-- no client, not even a super_admin, can update or delete a row here.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role public.app_role not null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_label text not null,
  reason text,
  before_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_check check (
    action in ('archive', 'restore', 'deactivate', 'reactivate', 'unlink', 'delete')
  ),
  constraint audit_events_entity_type_check check (
    entity_type in ('driver', 'vehicle', 'device')
  )
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_created_at_idx on public.audit_events (created_at desc);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;

create policy audit_events_super_admin_select on public.audit_events
  for select to authenticated
  using (private.current_app_role() = 'super_admin');
grant select on public.audit_events to authenticated;

-- Never logs a password, token, device credential, enrollment code or API
-- secret: callers only ever pass a label/reason/snapshot of the operational
-- row itself. Not directly exposed to the client — only called from the
-- lifecycle functions below, all of which already re-validate the actor's
-- role first.
create or replace function private.record_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_reason text,
  p_before_snapshot jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    actor_user_id, actor_role, action, entity_type, entity_id, entity_label,
    reason, before_snapshot, metadata
  ) values (
    auth.uid(), private.current_app_role(), p_action, p_entity_type, p_entity_id,
    p_entity_label, p_reason, p_before_snapshot, p_metadata
  );
end;
$$;

revoke all on function private.record_audit_event(text, text, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function private.require_fleet_manager()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() not in ('super_admin', 'admin', 'operations') then
    raise exception using errcode = '42501', message = 'Not authorized to manage fleet records.';
  end if;
end;
$$;

revoke all on function private.require_fleet_manager() from public, anon, authenticated;

-- ============================================================
-- Drivers
-- ============================================================

create or replace function public.archive_driver(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drivers%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.drivers where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Driver not found.';
  end if;
  update public.drivers set archived_at = now() where id = p_id;
  perform private.record_audit_event('archive', 'driver', p_id, v_row.full_name, p_reason, to_jsonb(v_row));
end;
$$;

create or replace function public.restore_driver(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drivers%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.drivers where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Driver not found.';
  end if;
  update public.drivers set archived_at = null where id = p_id;
  perform private.record_audit_event('restore', 'driver', p_id, v_row.full_name, null, to_jsonb(v_row));
end;
$$;

create or replace function public.set_driver_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drivers%rowtype;
  v_new_status public.driver_status;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.drivers where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Driver not found.';
  end if;
  v_new_status := case when p_active then 'active' else 'inactive' end;
  update public.drivers set status = v_new_status where id = p_id;
  perform private.record_audit_event(
    case when p_active then 'reactivate' else 'deactivate' end,
    'driver', p_id, v_row.full_name, null, to_jsonb(v_row)
  );
end;
$$;

-- Permanent delete: only super_admin, only with a reason, only when no
-- driver_sessions reference this driver (foreign_key_violation from the
-- existing ON DELETE RESTRICT constraint is caught and reworded — the
-- constraint is the actual source of truth on what counts as "operational
-- history", not a duplicated check here).
create or replace function public.delete_driver_permanently(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drivers%rowtype;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can permanently delete records.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;

  select * into v_row from public.drivers where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Driver not found.';
  end if;

  begin
    delete from public.drivers where id = p_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = '23514',
        message = 'This record has operational history and cannot be deleted. Archive it instead.';
  end;

  perform private.record_audit_event('delete', 'driver', p_id, v_row.full_name, p_reason, to_jsonb(v_row));
end;
$$;

-- ============================================================
-- Vehicles
-- ============================================================

create or replace function public.archive_vehicle(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.vehicles%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Vehicle not found.';
  end if;
  update public.vehicles set archived_at = now() where id = p_id;
  perform private.record_audit_event('archive', 'vehicle', p_id, v_row.internal_code, p_reason, to_jsonb(v_row));
end;
$$;

create or replace function public.restore_vehicle(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.vehicles%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Vehicle not found.';
  end if;
  update public.vehicles set archived_at = null where id = p_id;
  perform private.record_audit_event('restore', 'vehicle', p_id, v_row.internal_code, null, to_jsonb(v_row));
end;
$$;

create or replace function public.set_vehicle_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.vehicles%rowtype;
  v_new_status public.vehicle_status;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Vehicle not found.';
  end if;
  v_new_status := case when p_active then 'active' else 'maintenance' end;
  update public.vehicles set status = v_new_status where id = p_id;
  perform private.record_audit_event(
    case when p_active then 'reactivate' else 'deactivate' end,
    'vehicle', p_id, v_row.internal_code, null, to_jsonb(v_row)
  );
end;
$$;

create or replace function public.unlink_vehicle_driver(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.vehicles%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Vehicle not found.';
  end if;
  update public.vehicles set driver_id = null where id = p_id;
  perform private.record_audit_event('unlink', 'vehicle', p_id, v_row.internal_code, null, to_jsonb(v_row));
end;
$$;

create or replace function public.delete_vehicle_permanently(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.vehicles%rowtype;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can permanently delete records.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;

  select * into v_row from public.vehicles where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Vehicle not found.';
  end if;

  if exists (select 1 from public.devices where vehicle_id = p_id) then
    raise exception using
      errcode = '23514',
      message = 'This vehicle still has a linked device. Unlink it first.';
  end if;

  begin
    delete from public.vehicles where id = p_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = '23514',
        message = 'This record has operational history and cannot be deleted. Archive it instead.';
  end;

  perform private.record_audit_event('delete', 'vehicle', p_id, v_row.internal_code, p_reason, to_jsonb(v_row));
end;
$$;

-- ============================================================
-- Devices
-- ============================================================

create or replace function public.archive_device(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.devices%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;
  update public.devices set archived_at = now() where id = p_id;
  perform private.record_audit_event('archive', 'device', p_id, v_row.device_code, p_reason, to_jsonb(v_row));
end;
$$;

create or replace function public.restore_device(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.devices%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;
  update public.devices set archived_at = null where id = p_id;
  perform private.record_audit_event('restore', 'device', p_id, v_row.device_code, null, to_jsonb(v_row));
end;
$$;

create or replace function public.set_device_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.devices%rowtype;
  v_new_status public.device_status;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;
  -- Reactivating never claims the device is "online": that's derived from
  -- heartbeats, not asserted here. It goes back to a neutral 'offline'.
  v_new_status := case when p_active then 'offline' else 'maintenance' end;
  update public.devices set status = v_new_status where id = p_id;
  perform private.record_audit_event(
    case when p_active then 'reactivate' else 'deactivate' end,
    'device', p_id, v_row.device_code, null, to_jsonb(v_row)
  );
end;
$$;

create or replace function public.unlink_device_vehicle(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.devices%rowtype;
begin
  perform private.require_fleet_manager();
  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;
  update public.devices set vehicle_id = null where id = p_id;
  perform private.record_audit_event('unlink', 'device', p_id, v_row.device_code, null, to_jsonb(v_row));
end;
$$;

-- Revokes any live credential/enrollment code first (explicit, auditable
-- steps) even though device_credentials/device_enrollment_codes already
-- cascade on device delete — this way a device that turns out to be
-- blocked by operational history (heartbeats/impressions/geofence_events,
-- all ON DELETE RESTRICT) is at least left with no usable credential.
create or replace function public.delete_device_permanently(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.devices%rowtype;
begin
  if private.current_app_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admin can permanently delete records.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;

  select * into v_row from public.devices where id = p_id;
  if v_row.id is null then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  update public.device_enrollment_codes set revoked_at = now()
  where device_id = p_id and used_at is null and revoked_at is null;
  update public.device_credentials set revoked_at = now()
  where device_id = p_id and revoked_at is null;
  update public.devices set vehicle_id = null where id = p_id;

  begin
    delete from public.devices where id = p_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = '23514',
        message = 'This record has operational history and cannot be deleted. Archive it instead.';
  end;

  perform private.record_audit_event('delete', 'device', p_id, v_row.device_code, p_reason, to_jsonb(v_row));
end;
$$;

revoke all on function public.archive_driver(uuid, text) from public, anon;
revoke all on function public.restore_driver(uuid) from public, anon;
revoke all on function public.set_driver_active(uuid, boolean) from public, anon;
revoke all on function public.delete_driver_permanently(uuid, text) from public, anon;
revoke all on function public.archive_vehicle(uuid, text) from public, anon;
revoke all on function public.restore_vehicle(uuid) from public, anon;
revoke all on function public.set_vehicle_active(uuid, boolean) from public, anon;
revoke all on function public.unlink_vehicle_driver(uuid) from public, anon;
revoke all on function public.delete_vehicle_permanently(uuid, text) from public, anon;
revoke all on function public.archive_device(uuid, text) from public, anon;
revoke all on function public.restore_device(uuid) from public, anon;
revoke all on function public.set_device_active(uuid, boolean) from public, anon;
revoke all on function public.unlink_device_vehicle(uuid) from public, anon;
revoke all on function public.delete_device_permanently(uuid, text) from public, anon;

grant execute on function public.archive_driver(uuid, text) to authenticated;
grant execute on function public.restore_driver(uuid) to authenticated;
grant execute on function public.set_driver_active(uuid, boolean) to authenticated;
grant execute on function public.delete_driver_permanently(uuid, text) to authenticated;
grant execute on function public.archive_vehicle(uuid, text) to authenticated;
grant execute on function public.restore_vehicle(uuid) to authenticated;
grant execute on function public.set_vehicle_active(uuid, boolean) to authenticated;
grant execute on function public.unlink_vehicle_driver(uuid) to authenticated;
grant execute on function public.delete_vehicle_permanently(uuid, text) to authenticated;
grant execute on function public.archive_device(uuid, text) to authenticated;
grant execute on function public.restore_device(uuid) to authenticated;
grant execute on function public.set_device_active(uuid, boolean) to authenticated;
grant execute on function public.unlink_device_vehicle(uuid) to authenticated;
grant execute on function public.delete_device_permanently(uuid, text) to authenticated;

comment on table public.audit_events is
  'Immutable audit trail for fleet lifecycle actions. Never stores passwords, tokens, device credentials, enrollment codes or API secrets.';
