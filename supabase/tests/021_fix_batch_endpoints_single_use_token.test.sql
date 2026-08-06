begin;

set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(6);

grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.devices (id, device_code, status) values
  ('21000000-0000-4000-8000-000000000010', 'TB-M13-01', 'provisioning');
insert into public.advertisers (id, legal_name, trade_name) values
  ('21000000-0000-4000-8000-000000000030', 'Advertiser M13 Ltda', 'Advertiser M13');
insert into public.campaigns (id, advertiser_id, name, campaign_type, status) values
  ('21000000-0000-4000-8000-000000000040', '21000000-0000-4000-8000-000000000030', 'Campaign M13', 'regular', 'draft');

-- A hand-seeded v2 bridge session token, the exact shape
-- mint_device_session_token produces — isolates device_id_for_token's
-- real single-use behavior without needing a full ECDSA key-enrollment
-- flow just to get one.
insert into public.device_key_credentials (id, device_id, key_id, public_key_der, public_key_fingerprint) values
  ('21000000-0000-4000-8000-000000000050', '21000000-0000-4000-8000-000000000010', '21000000-0000-4000-8000-000000000060', '\x00', 'fp-m13-01');
insert into private.device_key_session_tokens (device_id, key_id, token_hash, expires_at) values
  ('21000000-0000-4000-8000-000000000010', '21000000-0000-4000-8000-000000000060',
   private.hash_token('m13-session-token-0123456789abcdef0123456789abcdef'), now() + interval '60 seconds');

-- MAX-013 root cause, reproduced directly: the ORIGINAL token-taking RPC
-- consumes the token on its first call — a second event in the same
-- batch calling it again with the identical token is exactly what
-- previously turned into a whole-batch 401.
select is(
  (select recorded from public.record_device_playback_event(
    'm13-session-token-0123456789abcdef0123456789abcdef',
    '21000000-0000-4000-8000-000000000040', null, 'completed', now(), null, null, null, null, false, gen_random_uuid()
  )),
  true,
  'the first event in a batch, using the token-taking RPC directly, still succeeds'
);
select throws_ok(
  format(
    $$select public.record_device_playback_event(%L, '21000000-0000-4000-8000-000000000040', null, 'failed', now(), null, null, null, 'x', false, gen_random_uuid())$$,
    'm13-session-token-0123456789abcdef0123456789abcdef'
  ),
  '42501',
  'Invalid or revoked device credential.',
  'reproduces the bug directly: a second event reusing the same already-consumed token fails exactly this way'
);

-- The actual fix: seed a second, fresh token and prove the new
-- resolve-once-then-loop-by-device_id shape (what both edge functions
-- now do) lets every event in the batch succeed, not just the first.
insert into private.device_key_session_tokens (device_id, key_id, token_hash, expires_at) values
  ('21000000-0000-4000-8000-000000000010', '21000000-0000-4000-8000-000000000060',
   private.hash_token('m13-session-token-fresh-0123456789abcdef012345'), now() + interval '60 seconds');
select public.resolve_device_id_from_token('m13-session-token-fresh-0123456789abcdef012345') as device_id \gset
select is(:'device_id'::uuid, '21000000-0000-4000-8000-000000000010'::uuid, 'resolve_device_id_from_token resolves the token''s own device');

select is(
  (select recorded from public.record_device_playback_event_for_device(
    :'device_id'::uuid, '21000000-0000-4000-8000-000000000040', null, 'completed', now(), null, null, null, null, false, gen_random_uuid()
  )),
  true,
  'event 1 of the batch, by resolved device_id, succeeds'
);
select is(
  (select recorded from public.record_device_playback_event_for_device(
    :'device_id'::uuid, '21000000-0000-4000-8000-000000000040', null, 'failed', now(), null, null, null, 'watchdog_timeout', false, gen_random_uuid()
  )),
  true,
  'event 2 of the SAME batch, same resolved device_id, also succeeds -- this is exactly what used to 401'
);

-- Idempotency: replaying the same clientEventId is a no-op, never a
-- second row.
select public.record_device_playback_event_for_device(
  :'device_id'::uuid, '21000000-0000-4000-8000-000000000040', null, 'completed', now(), null, null, null, null, false, '21000000-0000-4000-8000-0000000000f1'
);
select public.record_device_playback_event_for_device(
  :'device_id'::uuid, '21000000-0000-4000-8000-000000000040', null, 'completed', now(), null, null, null, null, false, '21000000-0000-4000-8000-0000000000f1'
);
select is(
  (select count(*)::integer from public.impressions where client_event_id = '21000000-0000-4000-8000-0000000000f1'),
  1,
  'replaying the same clientEventId never inserts a second impressions row'
);

select * from finish();
rollback;
