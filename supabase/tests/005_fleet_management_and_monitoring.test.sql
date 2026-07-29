begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(20);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.drivers (id, full_name, status) values
  ('25000000-0000-4000-8000-000000000001', 'Motorista Um', 'active'),
  ('25000000-0000-4000-8000-000000000002', 'Motorista Dois', 'active');

insert into public.advertisers (id, legal_name, trade_name) values
  ('15000000-0000-4000-8000-000000000001', 'Anunciante MAX-005 Ltda', 'Anunciante MAX-005');

insert into public.vehicles (id, driver_id, internal_code, license_plate, status) values
  ('45000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', 'car-501', 'abc-1d23', 'active'),
  ('45000000-0000-4000-8000-000000000002', null, 'CAR-502', 'ABC1234', 'active');

select is(
  (select internal_code from public.vehicles where id = '45000000-0000-4000-8000-000000000001'),
  'CAR-501',
  'vehicle internal code is normalized'
);
select is(
  (select license_plate from public.vehicles where id = '45000000-0000-4000-8000-000000000001'),
  'ABC1D23',
  'Mercosul plate is normalized'
);
select throws_ok(
  $$insert into public.vehicles (internal_code, license_plate) values ('CAR-X', 'INVALID')$$,
  '22023',
  'Invalid Brazilian license plate.',
  'invalid Brazilian plate is rejected'
);
select throws_ok(
  $$insert into public.vehicles (driver_id, internal_code)
    values ('25000000-0000-4000-8000-000000000001', 'CAR-503')$$,
  '23505',
  null,
  'one driver cannot be linked to two current vehicles'
);

insert into public.devices (id, vehicle_id, device_code, status) values
  ('55000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000001', 'tb-501', 'online'),
  ('55000000-0000-4000-8000-000000000002', null, 'TB-502', 'provisioning');

select is(
  (select device_code from public.devices where id = '55000000-0000-4000-8000-000000000001'),
  'TB-501',
  'device code is normalized'
);
select throws_ok(
  $$update public.devices
    set vehicle_id = '45000000-0000-4000-8000-000000000001'
    where id = '55000000-0000-4000-8000-000000000002'$$,
  '23505',
  null,
  'one vehicle cannot receive two current devices'
);

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('05000000-0000-4000-8000-000000000001', 'super5@example.test', '{"full_name":"Super MAX-005"}', now(), now()),
  ('05000000-0000-4000-8000-000000000002', 'operations5@example.test', '{}', now(), now()),
  ('05000000-0000-4000-8000-000000000003', 'advertiser5@example.test', '{}', now(), now()),
  ('05000000-0000-4000-8000-000000000004', 'driver5@example.test', '{}', now(), now());

select is(
  (select role::text from public.profiles where id = '05000000-0000-4000-8000-000000000001'),
  'pending',
  'auth trigger creates a pending profile'
);
select is(
  (select full_name from public.profiles where id = '05000000-0000-4000-8000-000000000001'),
  'Super MAX-005',
  'auth trigger copies the optional full name'
);

update public.profiles set role = 'super_admin'
where id = '05000000-0000-4000-8000-000000000001';
update public.profiles set role = 'operations'
where id = '05000000-0000-4000-8000-000000000002';
update public.profiles
set role = 'driver', driver_id = '25000000-0000-4000-8000-000000000001'
where id = '05000000-0000-4000-8000-000000000004';

-- The advertiser binding check intentionally prevents an invalid role setup.
select throws_ok(
  $$update public.profiles set role = 'advertiser'
    where id = '05000000-0000-4000-8000-000000000003'$$,
  '23514',
  null,
  'advertiser requires a persisted advertiser binding'
);
update public.profiles
set role = 'advertiser', advertiser_id = '15000000-0000-4000-8000-000000000001'
where id = '05000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '05000000-0000-4000-8000-000000000002', true);
select is(
  (
    select count(*)::integer
    from public.drivers
    where id in (
      '25000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000002'
    )
  ),
  2,
  'operations reads fleet drivers'
);
select lives_ok(
  $$update public.devices set app_version = '1.0.1' where id = '55000000-0000-4000-8000-000000000001'$$,
  'operations can update fleet devices'
);
select throws_ok(
  $$select public.simulate_device_heartbeat(
    '55000000-0000-4000-8000-000000000001', 80::smallint, true, true,
    1000000::bigint, 'test', -20.46, -54.62
  )$$,
  '42501',
  'Super admin required.',
  'operations cannot use the development heartbeat simulator'
);

select set_config('request.jwt.claim.sub', '05000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.simulate_device_heartbeat(
    '55000000-0000-4000-8000-000000000001', 80::smallint, true, true,
    1000000::bigint, '1.0.2-test', -20.46, -54.62
  )$$,
  'super admin can simulate a heartbeat'
);
select is(
  (select count(*)::integer from public.device_heartbeats where device_id = '55000000-0000-4000-8000-000000000001'),
  1,
  'simulated heartbeat is persisted'
);
select is(
  (select heartbeat_app_version from public.device_monitoring_view where id = '55000000-0000-4000-8000-000000000001'),
  '1.0.2-test',
  'monitoring view exposes latest heartbeat'
);
select ok(
  (select latitude is not null and longitude is not null from public.device_monitoring_view where id = '55000000-0000-4000-8000-000000000001'),
  'monitoring view exposes PostGIS coordinates'
);

select set_config('request.jwt.claim.sub', '05000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.drivers), 0, 'advertiser cannot read fleet drivers');

select set_config('request.jwt.claim.sub', '05000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.vehicles), 1, 'driver reads only own vehicle');
select is((select count(*)::integer from public.devices), 1, 'driver reads only own device');
select throws_ok(
  $$insert into public.drivers (full_name) values ('Forbidden Driver')$$,
  '42501',
  'new row violates row-level security policy for table "drivers"',
  'driver cannot create fleet records'
);

reset role;
select * from finish();
rollback;
