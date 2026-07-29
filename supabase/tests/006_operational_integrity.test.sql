begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('06000000-0000-4000-8000-000000000001', 'super6-a@example.test', '{}', now(), now()),
  ('06000000-0000-4000-8000-000000000002', 'super6-b@example.test', '{}', now(), now());

update public.profiles set role = 'super_admin', active = true
where id in (
  '06000000-0000-4000-8000-000000000001',
  '06000000-0000-4000-8000-000000000002'
);

-- Two active super_admins: demoting one is fine.
select lives_ok(
  $$update public.profiles set role = 'admin' where id = '06000000-0000-4000-8000-000000000002'$$,
  'demoting a super_admin is allowed while another remains active'
);

-- Down to a single active super_admin: demotion must be blocked.
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '06000000-0000-4000-8000-000000000001'$$,
  '23514',
  'At least one active super_admin is required; promote another profile first.',
  'the last super_admin cannot be demoted'
);
select throws_ok(
  $$update public.profiles set active = false where id = '06000000-0000-4000-8000-000000000001'$$,
  '23514',
  'At least one active super_admin is required; promote another profile first.',
  'the last active super_admin cannot be deactivated'
);
select throws_ok(
  $$delete from public.profiles where id = '06000000-0000-4000-8000-000000000001'$$,
  '23514',
  'At least one active super_admin is required; promote another profile first.',
  'the last active super_admin profile cannot be deleted'
);
select is(
  (select role::text from public.profiles where id = '06000000-0000-4000-8000-000000000001'),
  'super_admin',
  'the protected profile is unchanged after the blocked attempts'
);

-- Promoting a second super_admin unblocks changes to the first again.
update public.profiles set role = 'super_admin', active = true
where id = '06000000-0000-4000-8000-000000000002';
select lives_ok(
  $$update public.profiles set active = false where id = '06000000-0000-4000-8000-000000000001'$$,
  'deactivating a super_admin is allowed again once another one is active'
);

select * from finish();
rollback;
