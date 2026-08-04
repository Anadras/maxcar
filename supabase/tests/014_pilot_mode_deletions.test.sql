begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(10);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('e1000000-0000-4000-8000-000000000001', 'super14@example.test', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'admin14@example.test', '{}', now(), now());
update public.profiles set role = 'super_admin' where id = 'e1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin' where id = 'e1000000-0000-4000-8000-000000000002';

insert into public.advertisers (id, legal_name, trade_name) values
  ('e2000000-0000-4000-8000-000000000001', 'Cliente Piloto Ltda', 'Cliente Piloto');
insert into public.establishments (id, advertiser_id, name, address_line, city, state, location) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Unidade Teste', 'Rua Teste', 'Campo Grande', 'MS', st_setsrid(st_makepoint(-54.62, -20.47), 4326)::geography);
insert into public.campaigns (id, advertiser_id, name, campaign_type, status) values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Campanha Teste', 'regular', 'draft');

select ok((select pilot_mode from public.system_settings where singleton), 'pilot mode starts enabled');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.delete_campaign_permanently('e4000000-0000-4000-8000-000000000001', 'teste')$$,
  '42501', 'Only super_admin can permanently delete records.',
  'admin cannot permanently delete campaign'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.delete_campaign_permanently('e4000000-0000-4000-8000-000000000001', '')$$,
  '22023', 'A reason is required.', 'reason is required'
);
select lives_ok(
  $$select public.delete_campaign_permanently('e4000000-0000-4000-8000-000000000001', 'campanha duplicada')$$,
  'super_admin deletes pilot campaign'
);
select is((select count(*)::integer from public.campaigns where id = 'e4000000-0000-4000-8000-000000000001'), 0, 'campaign is removed');
select is((select count(*)::integer from public.audit_events where entity_id = 'e4000000-0000-4000-8000-000000000001' and action = 'delete'), 1, 'campaign deletion is audited');

select lives_ok(
  $$select public.delete_advertiser_permanently('e2000000-0000-4000-8000-000000000001', 'encerrar cliente de teste')$$,
  'super_admin deletes pilot client tree'
);
select is((select count(*)::integer from public.advertisers where id = 'e2000000-0000-4000-8000-000000000001'), 0, 'client is removed');
select is((select count(*)::integer from public.establishments where advertiser_id = 'e2000000-0000-4000-8000-000000000001'), 0, 'client units are removed');
select is((select count(*)::integer from public.audit_events where entity_id = 'e2000000-0000-4000-8000-000000000001' and action = 'delete'), 1, 'client deletion is audited');

select * from finish();
rollback;
