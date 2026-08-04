-- MAX-011 Bloco 8: create_device_command was a blind INSERT, so any action
-- that fans a command out to every device (publishCampaignAndSync loops
-- every non-archived device and queues a sync_now on every publish) grew an
-- unbounded backlog of duplicate pending commands for a device that simply
-- hadn't polled yet — exactly the "vários sync_now pendentes" symptom.
-- Idempotent by device_id + command_type + not-yet-finished status: a
-- fresh request for the same not-yet-delivered-or-completed command just
-- extends its expiry instead of piling on a duplicate row.

create or replace function public.create_device_command(
  p_device_id uuid,
  p_command_type public.device_command_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_fleet_manager();

  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception using errcode = '22023', message = 'Device not found.';
  end if;

  select id into v_id
  from public.device_commands
  where device_id = p_device_id
    and command_type = p_command_type
    and status in ('pending', 'delivered')
  order by created_at desc
  limit 1;

  if v_id is not null then
    update public.device_commands
    set expires_at = now() + interval '1 hour'
    where id = v_id;
    return v_id;
  end if;

  insert into public.device_commands (device_id, command_type, issued_by)
  values (p_device_id, p_command_type, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_device_command(uuid, public.device_command_type) is
  'Idempotent per device+command_type while pending/delivered: refreshes the existing row''s expiry instead of duplicating it.';
