-- MAXCAR FAKE / DEVELOPMENT DATA.
-- Names, documents, contacts, plates and coordinates below are fictional and
-- must never be presented as real customer or personal data.

insert into public.advertisers (
  id, legal_name, trade_name, document_number, contact_name, contact_email, contact_phone, status
) values
  ('10000000-0000-4000-8000-000000000001', 'Midiamax Desenvolvimento Ltda.', 'Midiamax', 'DEV-DOC-0001', 'Contato Demonstração', 'midiamax@example.test', '+55 67 0000-0001', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'Pizzaria Central Desenvolvimento Ltda.', 'Pizzaria Central', 'DEV-DOC-0002', 'Contato Demonstração', 'pizzaria@example.test', '+55 67 0000-0002', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'Academia Prime Desenvolvimento Ltda.', 'Academia Prime', 'DEV-DOC-0003', 'Contato Demonstração', 'academia@example.test', '+55 67 0000-0003', 'active')
on conflict (id) do nothing;

insert into public.drivers (id, full_name, document_number, phone, email, status) values
  ('20000000-0000-4000-8000-000000000001', 'Carlos Demo', 'DEV-DRIVER-0001', '+55 67 0000-0101', 'carlos@example.test', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'Ana Demo', 'DEV-DRIVER-0002', '+55 67 0000-0102', 'ana@example.test', 'active'),
  ('20000000-0000-4000-8000-000000000003', 'Bruno Demo', 'DEV-DRIVER-0003', '+55 67 0000-0103', 'bruno@example.test', 'active')
on conflict (id) do nothing;

insert into public.establishments (
  id, advertiser_id, name, address_line, number, neighborhood, city, state, postal_code, location, active
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'Pizzaria Central — Unidade Demo',
    'Avenida de Desenvolvimento',
    '100',
    'Centro Demo',
    'Campo Grande',
    'MS',
    '79000-000',
    extensions.st_setsrid(extensions.st_makepoint(-54.6201, -20.4697), 4326)::extensions.geography,
    true
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'Academia Prime — Unidade Demo',
    'Rua de Desenvolvimento',
    '200',
    'Jardim Demo',
    'Campo Grande',
    'MS',
    '79000-001',
    extensions.st_setsrid(extensions.st_makepoint(-54.6112, -20.4584), 4326)::extensions.geography,
    true
  )
on conflict (id) do nothing;

insert into public.vehicles (
  id, driver_id, internal_code, license_plate, make, model, year, status
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'CAR-001', 'DEV0A01', 'Marca Demo', 'Modelo A', 2024, 'active'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'CAR-002', 'DEV0A02', 'Marca Demo', 'Modelo B', 2023, 'active'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'CAR-003', 'DEV0A03', 'Marca Demo', 'Modelo C', 2022, 'active')
on conflict (id) do nothing;

insert into public.devices (
  id, vehicle_id, device_code, status, app_version, last_seen_at, last_sync_at
) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'TB-001', 'online', '1.0.0-dev', now(), now()),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'TB-002', 'online', '1.0.0-dev', now() - interval '10 minutes', now() - interval '10 minutes'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'TB-003', 'online', '1.0.0-dev', now() - interval '30 minutes', now() - interval '30 minutes')
on conflict (id) do nothing;

insert into public.campaigns (
  id, advertiser_id, name, campaign_type, status, starts_at, ends_at,
  daily_start_time, daily_end_time, priority, cooldown_seconds,
  max_daily_impressions, active_days
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Institucional Midiamax — Demo',
    'regular',
    'draft',
    '2026-01-01 00:00:00-04',
    '2027-12-31 23:59:59-04',
    null,
    null,
    50,
    0,
    null,
    array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Oferta Pizzaria Central — Demo',
    'geo',
    'draft',
    '2026-01-01 00:00:00-04',
    '2027-12-31 23:59:59-04',
    '11:00',
    '23:00',
    85,
    900,
    2000,
    array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'Plano Prime — Demo',
    'geo',
    'draft',
    '2026-01-01 00:00:00-04',
    '2027-12-31 23:59:59-04',
    '06:00',
    '22:00',
    70,
    1800,
    1000,
    array[1, 2, 3, 4, 5, 6]::smallint[]
  )
on conflict (id) do nothing;

insert into public.campaign_creatives (
  id, campaign_id, name, creative_type, storage_path, duration_seconds, file_size_bytes, checksum, active
) values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Institucional 15s — Demo', 'video', 'advertisers/10000000-0000-4000-8000-000000000001/campaigns/60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.mp4', 15, 12000000, repeat('a', 64), true),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'Oferta Pizzaria 15s — Demo', 'video', 'advertisers/10000000-0000-4000-8000-000000000002/campaigns/60000000-0000-4000-8000-000000000002/70000000-0000-4000-8000-000000000002.mp4', 15, 11000000, repeat('b', 64), true),
  ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 'Plano Prime — Demo', 'image', 'advertisers/10000000-0000-4000-8000-000000000003/campaigns/60000000-0000-4000-8000-000000000003/70000000-0000-4000-8000-000000000003.webp', 10, 900000, repeat('c', 64), true)
on conflict (id) do nothing;

insert into public.campaign_geofences (
  id, campaign_id, establishment_id, radius_meters, priority_override, cooldown_override_seconds, active
) values
  ('80000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 1500, 90, 900, true),
  ('80000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 900, null, null, true)
on conflict (id) do nothing;

update public.campaigns
set status = 'active'
where id in (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000003'
);

insert into public.playlists (id, name, active) values
  ('90000000-0000-4000-8000-000000000001', 'Grade piloto Campo Grande — Demo', true)
on conflict (id) do nothing;

insert into public.playlist_items (id, playlist_id, campaign_id, position, active) values
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, true)
on conflict (id) do nothing;

insert into public.device_heartbeats (
  id, device_id, recorded_at, battery_level, network_connected, gps_available,
  storage_free_bytes, app_version, location
) values
  (
    'a0000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    now(),
    87,
    true,
    true,
    24000000000,
    '1.0.0-dev',
    extensions.st_setsrid(extensions.st_makepoint(-54.6188, -20.4701), 4326)::extensions.geography
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    now() - interval '10 minutes',
    54,
    true,
    true,
    18000000000,
    '1.0.0-dev',
    extensions.st_setsrid(extensions.st_makepoint(-54.6112, -20.4584), 4326)::extensions.geography
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000003',
    now() - interval '30 minutes',
    18,
    false,
    false,
    9000000000,
    '1.0.0-dev',
    extensions.st_setsrid(extensions.st_makepoint(-54.6500, -20.4900), 4326)::extensions.geography
  )
on conflict (id) do nothing;

insert into public.impressions (
  id, device_id, vehicle_id, campaign_id, creative_id, source, status,
  started_at, completed_at, duration_ms, completion_percentage, location,
  offline_generated, client_event_id
) values
  (
    'b0000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'regular',
    'completed',
    now() - interval '15 seconds',
    now(),
    15000,
    100,
    extensions.st_setsrid(extensions.st_makepoint(-54.6188, -20.4701), 4326)::extensions.geography,
    true,
    'b1000000-0000-4000-8000-000000000001'
  )
on conflict (id) do nothing;

insert into public.driver_sessions (
  id, driver_id, vehicle_id, device_id, started_at, status
) values
  (
    'c0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    now() - interval '6 hours',
    'active'
  )
on conflict (id) do nothing;
