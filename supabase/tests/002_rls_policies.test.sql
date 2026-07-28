begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- The temporary authenticated role needs the assertion helpers while this
-- transaction deliberately exercises policies under that role.
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.advertisers (id, legal_name, trade_name) values
  ('11000000-0000-4000-8000-000000000001', 'RLS Advertiser A Test', 'RLS A'),
  ('11000000-0000-4000-8000-000000000002', 'RLS Advertiser B Test', 'RLS B');

insert into public.drivers (id, full_name, status) values
  ('21000000-0000-4000-8000-000000000001', 'RLS Driver A Test', 'active'),
  ('21000000-0000-4000-8000-000000000002', 'RLS Driver B Test', 'active');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('01000000-0000-4000-8000-000000000001', 'pending@example.test', '{"full_name":"Pending Test"}', now(), now()),
  ('01000000-0000-4000-8000-000000000002', 'advertiser@example.test', '{"full_name":"Advertiser Test"}', now(), now()),
  ('01000000-0000-4000-8000-000000000003', 'driver@example.test', '{"full_name":"Driver Test"}', now(), now()),
  ('01000000-0000-4000-8000-000000000004', 'commercial@example.test', '{"full_name":"Commercial Test"}', now(), now()),
  ('01000000-0000-4000-8000-000000000005', 'operations@example.test', '{"full_name":"Operations Test"}', now(), now()),
  ('01000000-0000-4000-8000-000000000006', 'admin@example.test', '{"full_name":"Admin Test"}', now(), now());

update public.profiles
set role = 'advertiser', advertiser_id = '11000000-0000-4000-8000-000000000001'
where id = '01000000-0000-4000-8000-000000000002';

update public.profiles
set role = 'driver', driver_id = '21000000-0000-4000-8000-000000000001'
where id = '01000000-0000-4000-8000-000000000003';

update public.profiles set role = 'commercial'
where id = '01000000-0000-4000-8000-000000000004';
update public.profiles set role = 'operations'
where id = '01000000-0000-4000-8000-000000000005';
update public.profiles set role = 'admin'
where id = '01000000-0000-4000-8000-000000000006';

set local role authenticated;

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.advertisers), 0, 'pending cannot read advertisers');
select is((select count(*)::integer from public.profiles), 1, 'pending can read only the own profile');
update public.profiles set role = 'super_admin'
where id = '01000000-0000-4000-8000-000000000001';
select is(
  (select role::text from public.profiles where id = auth.uid()),
  'pending',
  'pending cannot elevate the own role'
);

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.advertisers where id = '11000000-0000-4000-8000-000000000001'),
  1,
  'advertiser can read the own advertiser'
);
select is(
  (select count(*)::integer from public.advertisers where id = '11000000-0000-4000-8000-000000000002'),
  0,
  'advertiser cannot read another advertiser'
);

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.drivers where id = '21000000-0000-4000-8000-000000000001'),
  1,
  'driver can read the own driver record'
);
select is(
  (select count(*)::integer from public.drivers where id = '21000000-0000-4000-8000-000000000002'),
  0,
  'driver cannot read another driver'
);

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.vehicles), 0, 'commercial cannot read vehicles');
select ok((select count(*) from public.advertisers) >= 2, 'commercial can read advertisers');

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000005', true);
select ok((select count(*) from public.vehicles) >= 2, 'operations can read vehicles');
select is((select count(*)::integer from public.advertisers), 0, 'operations cannot read advertiser records');

select set_config('request.jwt.claim.sub', '01000000-0000-4000-8000-000000000006', true);
select ok((select count(*) from public.advertisers) >= 2, 'admin can read advertisers');
select ok((select count(*) from public.vehicles) >= 2, 'admin can read vehicles');

reset role;
select * from finish();
rollback;
