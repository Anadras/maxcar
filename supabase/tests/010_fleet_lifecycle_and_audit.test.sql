begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(21);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('a1000000-0000-4000-8000-000000000001', 'super10@example.test', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'ops10@example.test', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'commercial10@example.test', '{}', now(), now());

update public.profiles set role = 'super_admin' where id = 'a1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations' where id = 'a1000000-0000-4000-8000-000000000002';
update public.profiles set role = 'commercial' where id = 'a1000000-0000-4000-8000-000000000003';

insert into public.drivers (id, full_name, status) values
  ('a2000000-0000-4000-8000-000000000001', 'Motorista Ciclo Um', 'active'),
  ('a2000000-0000-4000-8000-000000000002', 'Motorista Ciclo Dois', 'active'),
  ('a2000000-0000-4000-8000-000000000003', 'Motorista Com Historico', 'active');

insert into public.advertisers (id, legal_name, trade_name) values
  ('a1000000-0000-4000-8000-000000000010', 'Anunciante Ciclo Ltda', 'Anunciante Ciclo');

insert into public.vehicles (id, driver_id, internal_code, status) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'CAR-901', 'active'),
  ('a3000000-0000-4000-8000-000000000002', null, 'CAR-902', 'active'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003', 'CAR-903', 'active');

insert into public.devices (id, vehicle_id, device_code, status) values
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'TB-901', 'online'),
  ('a4000000-0000-4000-8000-000000000002', null, 'TB-902', 'provisioning'),
  ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'TB-903', 'online');

-- A driver_sessions row is what actually blocks a hard delete (ON DELETE
-- RESTRICT) — the function relies on this constraint rather than
-- duplicating the check.
insert into public.driver_sessions (driver_id, vehicle_id, started_at, status) values
  ('a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', now() - interval '2 hours', 'completed');

insert into public.device_heartbeats (device_id, recorded_at, network_connected, gps_available) values
  ('a4000000-0000-4000-8000-000000000003', now(), true, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select public.archive_driver('a2000000-0000-4000-8000-000000000001', 'teste')$$,
  '42501',
  'Not authorized to manage fleet records.',
  'commercial cannot archive a driver'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$select public.archive_driver('a2000000-0000-4000-8000-000000000001', 'Motorista afastado')$$,
  'operations can archive a driver'
);
select is(
  (select archived_at is not null from public.drivers where id = 'a2000000-0000-4000-8000-000000000001'),
  true,
  'the driver is now archived'
);
select lives_ok(
  $$select public.restore_driver('a2000000-0000-4000-8000-000000000001')$$,
  'the archived driver can be restored'
);
select is(
  (select archived_at from public.drivers where id = 'a2000000-0000-4000-8000-000000000001'),
  null,
  'restoring clears archived_at'
);

select lives_ok(
  $$select public.set_driver_active('a2000000-0000-4000-8000-000000000002', false)$$,
  'a driver can be deactivated'
);
select is(
  (select status::text from public.drivers where id = 'a2000000-0000-4000-8000-000000000002'),
  'inactive',
  'deactivation sets status to inactive'
);
select lives_ok(
  $$select public.set_driver_active('a2000000-0000-4000-8000-000000000002', true)$$,
  'a driver can be reactivated'
);

select throws_ok(
  $$select public.delete_driver_permanently('a2000000-0000-4000-8000-000000000003', 'teste')$$,
  '42501',
  'Only super_admin can permanently delete records.',
  'operations cannot permanently delete, only super_admin'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.delete_driver_permanently('a2000000-0000-4000-8000-000000000001', '')$$,
  '22023',
  'A reason is required.',
  'a blank reason is rejected for permanent delete, even for super_admin'
);

select throws_ok(
  $$select public.delete_driver_permanently('a2000000-0000-4000-8000-000000000003', 'teste')$$,
  '23514',
  'This record has operational history and cannot be deleted. Archive it instead.',
  'a driver with session history cannot be hard-deleted, even by super_admin'
);
select lives_ok(
  $$select public.delete_driver_permanently('a2000000-0000-4000-8000-000000000001', 'Cadastro duplicado por engano')$$,
  'a driver with no history can be permanently deleted by super_admin'
);
select is(
  (select count(*)::integer from public.drivers where id = 'a2000000-0000-4000-8000-000000000001'),
  0,
  'the driver row is gone'
);
select is(
  (select count(*)::integer from public.audit_events
   where entity_type = 'driver' and entity_id = 'a2000000-0000-4000-8000-000000000001' and action = 'delete'),
  1,
  'the deletion is recorded in the audit trail'
);

select throws_ok(
  $$select public.delete_vehicle_permanently('a3000000-0000-4000-8000-000000000001', 'teste')$$,
  '23514',
  'This vehicle still has a linked device. Unlink it first.',
  'a vehicle with a linked device cannot be permanently deleted'
);
select lives_ok(
  $$select public.unlink_device_vehicle('a4000000-0000-4000-8000-000000000001')$$,
  'a device can be unlinked from its vehicle'
);
select is(
  (select vehicle_id from public.devices where id = 'a4000000-0000-4000-8000-000000000001'),
  null,
  'the device no longer references the vehicle'
);

select throws_ok(
  $$select public.delete_device_permanently('a4000000-0000-4000-8000-000000000003', 'teste')$$,
  '23514',
  'This record has operational history and cannot be deleted. Archive it instead.',
  'a device with heartbeat history cannot be hard-deleted'
);
select lives_ok(
  $$select public.delete_device_permanently('a4000000-0000-4000-8000-000000000002', 'Dispositivo de teste nunca usado')$$,
  'a device with no history can be permanently deleted'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.audit_events),
  0,
  'operations cannot read the audit trail (RLS restricts it to super_admin)'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select ok(
  (select count(*)::integer from public.audit_events) > 0,
  'super_admin can read the audit trail'
);

select * from finish();
rollback;
