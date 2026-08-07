begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(17);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

-- The development seed ships its own global-default playlist; deactivate
-- it so this file's own fixture owns that slot instead (harmless, the
-- whole file rolls back).
update public.playlists set active = false where device_id is null;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('e1000000-0000-4000-8000-000000000001', 'ops15@example.test', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'commercial15@example.test', '{}', now(), now());

update public.profiles set role = 'operations' where id = 'e1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'commercial' where id = 'e1000000-0000-4000-8000-000000000002';

insert into public.advertisers (id, legal_name, trade_name) values
  ('e1000000-0000-4000-8000-000000000010', 'MAX-011 Ltda', 'MAX-011');

insert into public.devices (id, device_code, status) values
  ('e1000000-0000-4000-8000-000000000020', 'TB-M11-01', 'online'),
  ('e1000000-0000-4000-8000-000000000021', 'TB-M11-02', 'online');

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, active_days
) values
  (
    'e1000000-0000-4000-8000-000000000030', 'e1000000-0000-4000-8000-000000000010',
    'Regular Restrita', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    'e1000000-0000-4000-8000-000000000031', 'e1000000-0000-4000-8000-000000000010',
    'Regular Sem Restrição', 'regular', 'draft',
    now() - interval '1 day', now() + interval '30 days',
    '00:00', '23:59', array[0,1,2,3,4,5,6]::smallint[]
  );

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path,
  duration_seconds, file_size_bytes, checksum, processing_status, processed_storage_path
) values
  (
    'e1000000-0000-4000-8000-000000000040', 'e1000000-0000-4000-8000-000000000030',
    'Restrita Creative', 'image',
    'advertisers/e1000000-0000-4000-8000-000000000010/campaigns/e1000000-0000-4000-8000-000000000030/e1000000-0000-4000-8000-000000000040.jpg',
    10, 400000, repeat('a', 64), 'ready',
    'media-processed/e1000000-0000-4000-8000-000000000040/output.jpg'
  ),
  (
    'e1000000-0000-4000-8000-000000000041', 'e1000000-0000-4000-8000-000000000031',
    'Sem Restrição Creative', 'image',
    'advertisers/e1000000-0000-4000-8000-000000000010/campaigns/e1000000-0000-4000-8000-000000000031/e1000000-0000-4000-8000-000000000041.jpg',
    10, 400000, repeat('b', 64), 'ready',
    'media-processed/e1000000-0000-4000-8000-000000000041/output.jpg'
  );

update public.campaigns set status = 'active' where id in (
  'e1000000-0000-4000-8000-000000000030', 'e1000000-0000-4000-8000-000000000031'
);

insert into public.playlists (id, name, device_id) values
  ('e1000000-0000-4000-8000-000000000050', 'Grade padrão do piloto (teste 15)', null);
insert into public.playlist_items (playlist_id, campaign_id, position) values
  ('e1000000-0000-4000-8000-000000000050', 'e1000000-0000-4000-8000-000000000030', 1),
  ('e1000000-0000-4000-8000-000000000050', 'e1000000-0000-4000-8000-000000000031', 2);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.set_campaign_devices(
      'e1000000-0000-4000-8000-000000000030',
      array['e1000000-0000-4000-8000-000000000020']::uuid[]
    )$$,
  '42501',
  'Not authorized to manage fleet records.',
  'commercial cannot assign a campaign to devices'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.set_campaign_devices(
      '00000000-0000-4000-8000-000000000000',
      array['e1000000-0000-4000-8000-000000000020']::uuid[]
    )$$,
  '22023',
  'Campaign not found.',
  'assignment cannot target an unknown campaign'
);
select throws_ok(
  $$select public.set_campaign_devices(
      'e1000000-0000-4000-8000-000000000030',
      array['00000000-0000-4000-8000-000000000000']::uuid[]
    )$$,
  '22023',
  'One or more devices were not found.',
  'assignment cannot reference an unknown device'
);

select lives_ok(
  $$select public.set_campaign_devices(
      'e1000000-0000-4000-8000-000000000030',
      array['e1000000-0000-4000-8000-000000000020']::uuid[]
    )$$,
  'operations can restrict the campaign to one device'
);
select is(
  (select count(*)::integer from public.campaign_devices
   where campaign_id = 'e1000000-0000-4000-8000-000000000030'),
  1,
  'exactly one allowlist row now exists'
);

reset role;

insert into public.device_enrollment_codes (device_id, code_hash, expires_at) values
  ('e1000000-0000-4000-8000-000000000020', encode(digest('DEVM1101', 'sha256'), 'hex'), now() + interval '15 minutes'),
  ('e1000000-0000-4000-8000-000000000021', encode(digest('DEVM1102', 'sha256'), 'hex'), now() + interval '15 minutes');
select device_token as tok1 from public.enroll_device('devm1101', 'e2000000-0000-4000-8000-000000000001') \gset
select device_token as tok2 from public.enroll_device('devm1102', 'e2000000-0000-4000-8000-000000000002') \gset

create temp view manifest1 as select jsonb_array_elements(public.get_device_manifest(:'tok1')->'playlist') as item;
create temp view manifest2 as select jsonb_array_elements(public.get_device_manifest(:'tok2')->'playlist') as item;

select is(
  (select count(*)::integer from manifest1 where item->>'campaignId' = 'e1000000-0000-4000-8000-000000000030'),
  1,
  'the allowlisted device receives the restricted campaign'
);
select is(
  (select count(*)::integer from manifest2 where item->>'campaignId' = 'e1000000-0000-4000-8000-000000000030'),
  0,
  'a device NOT in the allowlist never receives the restricted campaign'
);
select is(
  (select count(*)::integer from manifest1 where item->>'campaignId' = 'e1000000-0000-4000-8000-000000000031'),
  1,
  'the unrestricted campaign still reaches the first device (no allowlist rows at all)'
);
select is(
  (select count(*)::integer from manifest2 where item->>'campaignId' = 'e1000000-0000-4000-8000-000000000031'),
  1,
  'the unrestricted campaign still reaches the second device too — unchanged default behavior'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.set_campaign_devices(
      'e1000000-0000-4000-8000-000000000030',
      array['e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000021']::uuid[]
    )$$,
  'the allowlist can be replaced with a larger set'
);
select is(
  (select count(*)::integer from public.campaign_devices
   where campaign_id = 'e1000000-0000-4000-8000-000000000030'),
  2,
  'the previous single-row allowlist was replaced, not appended to'
);

select lives_ok(
  $$select public.set_campaign_devices('e1000000-0000-4000-8000-000000000030', array[]::uuid[])$$,
  'passing an empty array clears the restriction entirely'
);
select is(
  (select count(*)::integer from public.campaign_devices
   where campaign_id = 'e1000000-0000-4000-8000-000000000030'),
  0,
  'no allowlist rows remain — the campaign is unrestricted again'
);

reset role;
create temp view manifest1_after as select jsonb_array_elements(public.get_device_manifest(:'tok1')->'playlist') as item;
select is(
  (select count(*)::integer from manifest1_after where item->>'campaignId' = 'e1000000-0000-4000-8000-000000000030'),
  1,
  'once cleared, the campaign reaches every device again, exactly like before it was ever restricted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.campaign_device_admin_view
   where campaign_id = 'e1000000-0000-4000-8000-000000000030'
     and device_id in (
       'e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000021'
     )),
  2,
  'the admin view lists this test''s devices for the campaign, assigned or not'
);
select is(
  (select bool_and(explicitly_assigned = false) from public.campaign_device_admin_view
   where campaign_id = 'e1000000-0000-4000-8000-000000000030'
     and device_id in (
       'e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000021'
     )),
  true,
  'after clearing the allowlist, the admin view reports none as explicitly assigned'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.campaign_devices (campaign_id, device_id)
    values ('e1000000-0000-4000-8000-000000000030', 'e1000000-0000-4000-8000-000000000020')$$,
  null,
  null,
  'authenticated cannot insert campaign_devices directly; only the RPC can'
);
reset role;

select * from finish();
rollback;
