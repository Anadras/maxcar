begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

-- Same stray-default-playlist cleanup as every other test that exercises
-- the pilot's single global playlist (see 024's comment).
update public.playlists set active = false where device_id is null;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('26000000-0000-4000-8000-000000000001', 'ops26@example.test', '{}', now(), now()),
  ('26000000-0000-4000-8000-000000000002', 'sales26@example.test', '{}', now(), now());
update public.profiles set role = 'operations' where id = '26000000-0000-4000-8000-000000000001';
update public.profiles set role = 'commercial' where id = '26000000-0000-4000-8000-000000000002';

insert into public.advertisers (id, legal_name, trade_name) values
  ('26000000-0000-4000-8000-000000000010', 'MAX-015 Ordem Ltda', 'MAX-015 Ordem');

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values
  ('26000000-0000-4000-8000-000000000021', '26000000-0000-4000-8000-000000000010', 'Regular A', 'regular', 'draft', now() - interval '1 day', now() + interval '30 days', '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]),
  ('26000000-0000-4000-8000-000000000022', '26000000-0000-4000-8000-000000000010', 'Regular B', 'regular', 'draft', now() - interval '1 day', now() + interval '30 days', '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]),
  ('26000000-0000-4000-8000-000000000023', '26000000-0000-4000-8000-000000000010', 'Regular C', 'regular', 'draft', now() - interval '1 day', now() + interval '30 days', '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]);

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum
) values
  ('26000000-0000-4000-8000-000000000041', '26000000-0000-4000-8000-000000000021', 'Creative A', 'image', 'advertisers/26000000-0000-4000-8000-000000000010/campaigns/26000000-0000-4000-8000-000000000021/a.jpg', 10, 400000, repeat('1', 64)),
  ('26000000-0000-4000-8000-000000000042', '26000000-0000-4000-8000-000000000022', 'Creative B', 'image', 'advertisers/26000000-0000-4000-8000-000000000010/campaigns/26000000-0000-4000-8000-000000000022/b.jpg', 10, 400000, repeat('2', 64)),
  ('26000000-0000-4000-8000-000000000043', '26000000-0000-4000-8000-000000000023', 'Creative C', 'image', 'advertisers/26000000-0000-4000-8000-000000000010/campaigns/26000000-0000-4000-8000-000000000023/c.jpg', 10, 400000, repeat('3', 64));

update public.campaigns set status = 'active'
  where id in (
    '26000000-0000-4000-8000-000000000021',
    '26000000-0000-4000-8000-000000000022',
    '26000000-0000-4000-8000-000000000023'
  );

insert into public.playlists (id, name, device_id) values
  ('26000000-0000-4000-8000-000000000030', 'Grade padrão do piloto', null);
insert into public.playlist_items (playlist_id, campaign_id, position) values
  ('26000000-0000-4000-8000-000000000030', '26000000-0000-4000-8000-000000000021', 1),
  ('26000000-0000-4000-8000-000000000030', '26000000-0000-4000-8000-000000000022', 2),
  ('26000000-0000-4000-8000-000000000030', '26000000-0000-4000-8000-000000000023', 3);

set local role authenticated;
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.reorder_default_playlist(array[
    '26000000-0000-4000-8000-000000000023', '26000000-0000-4000-8000-000000000022', '26000000-0000-4000-8000-000000000021'
  ]::uuid[])$$,
  '42501',
  'Not authorized to manage fleet records.',
  'commercial cannot reorder the pilot grade'
);

select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.reorder_default_playlist(array[
    '26000000-0000-4000-8000-000000000021', '26000000-0000-4000-8000-000000000022'
  ]::uuid[])$$,
  '22023',
  'The provided order must contain exactly the current REGULAR campaigns in the pilot grade.',
  'a short/partial order is rejected'
);

reset role;
select is(
  (select array_agg(campaign_id order by position) from public.playlist_items where playlist_id = '26000000-0000-4000-8000-000000000030'),
  array['26000000-0000-4000-8000-000000000021','26000000-0000-4000-8000-000000000022','26000000-0000-4000-8000-000000000023']::uuid[],
  'a rejected reorder attempt leaves the original order untouched'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.reorder_default_playlist(array[
    '26000000-0000-4000-8000-000000000023', '26000000-0000-4000-8000-000000000021', '26000000-0000-4000-8000-000000000022'
  ]::uuid[])$$,
  'operations can reorder the pilot grade with the exact current campaign set'
);

reset role;
select is(
  (select position from public.playlist_items where campaign_id = '26000000-0000-4000-8000-000000000023'),
  1,
  'C is now position 1'
);
select is(
  (select position from public.playlist_items where campaign_id = '26000000-0000-4000-8000-000000000021'),
  2,
  'A is now position 2'
);
select is(
  (select position from public.playlist_items where campaign_id = '26000000-0000-4000-8000-000000000022'),
  3,
  'B is now position 3'
);
select is(
  (select count(*)::int from public.playlist_items where playlist_id = '26000000-0000-4000-8000-000000000030' and position not between 1 and 3),
  0,
  'no leftover temp (+100000) positions remain after a successful reorder'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.reorder_default_playlist(null)$$,
  '22023',
  'The provided order must contain exactly the current REGULAR campaigns in the pilot grade.',
  'a null order is rejected'
);

select * from finish();
rollback;
