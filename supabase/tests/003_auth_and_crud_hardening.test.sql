begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.advertisers (id, legal_name, trade_name) values
  ('13000000-0000-4000-8000-000000000001', 'MAX-003 Test Ltda', 'MAX-003 Test');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('03000000-0000-4000-8000-000000000001', 'super@example.test', '{}', now(), now()),
  ('03000000-0000-4000-8000-000000000002', 'admin2@example.test', '{}', now(), now()),
  ('03000000-0000-4000-8000-000000000003', 'commercial2@example.test', '{}', now(), now());

update public.profiles set role = 'super_admin'
where id = '03000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin'
where id = '03000000-0000-4000-8000-000000000002';
update public.profiles set role = 'commercial'
where id = '03000000-0000-4000-8000-000000000003';

set local role authenticated;

select set_config('request.jwt.claim.sub', '03000000-0000-4000-8000-000000000002', true);
update public.profiles set role = 'commercial'
where id = '03000000-0000-4000-8000-000000000001';
select is(
  (select role::text from public.profiles where id = '03000000-0000-4000-8000-000000000001'),
  'super_admin',
  'admin cannot demote a super admin'
);

select throws_ok(
  $$update public.profiles set role = 'super_admin'
    where id = '03000000-0000-4000-8000-000000000003'$$,
  '42501',
  'new row violates row-level security policy for table "profiles"',
  'admin cannot promote a user to super admin'
);

update public.profiles set active = false
where id = '03000000-0000-4000-8000-000000000002';
select ok(
  (select active from public.profiles where id = '03000000-0000-4000-8000-000000000002'),
  'admin cannot deactivate the own account'
);

select set_config('request.jwt.claim.sub', '03000000-0000-4000-8000-000000000001', true);
update public.profiles set role = 'operations'
where id = '03000000-0000-4000-8000-000000000003';
select is(
  (select role::text from public.profiles where id = '03000000-0000-4000-8000-000000000003'),
  'operations',
  'super admin can change staff roles'
);

select lives_ok(
  $$select public.save_establishment(
    null,
    '13000000-0000-4000-8000-000000000001',
    'Unidade Centro', 'Rua 14 de Julho', '100', '', 'Centro',
    'Campo Grande', 'MS', '79000-000', -20.4697, -54.6201, true
  )$$,
  'authorized staff can save a valid geography point'
);

select is(
  round(extensions.st_y(location::extensions.geometry)::numeric, 4),
  -20.4697::numeric,
  'saved latitude is correct'
)
from public.establishments where name = 'Unidade Centro';

select is(
  round(extensions.st_x(location::extensions.geometry)::numeric, 4),
  -54.6201::numeric,
  'saved longitude is correct'
)
from public.establishments where name = 'Unidade Centro';

select throws_ok(
  $$select public.save_establishment(
    null,
    '13000000-0000-4000-8000-000000000001',
    'Invalid Unit', 'Rua A', '', '', '', 'Campo Grande', 'MS', '',
    91, -54.6201, true
  )$$,
  '22023',
  'Latitude must be between -90 and 90.',
  'invalid latitude is rejected by the database'
);

reset role;
select * from finish();
rollback;
