-- MAX-002: geofence events, proof of play, operational heartbeat and driver sessions.

create table public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete restrict,
  campaign_geofence_id uuid not null references public.campaign_geofences (id) on delete restrict,
  event_type public.geofence_event_type not null,
  occurred_at timestamptz not null,
  location extensions.geography(Point, 4326) not null,
  distance_meters numeric(10, 2),
  created_at timestamptz not null default now(),
  constraint geofence_events_distance_check check (distance_meters is null or distance_meters >= 0)
);

create index geofence_events_device_occurred_at_idx
  on public.geofence_events (device_id, occurred_at desc);
create index geofence_events_campaign_geofence_id_idx
  on public.geofence_events (campaign_geofence_id);
create index geofence_events_location_gist_idx
  on public.geofence_events using gist (location);

create table public.impressions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete restrict,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  creative_id uuid references public.campaign_creatives (id) on delete restrict,
  source public.impression_source not null,
  status public.impression_status not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer,
  completion_percentage numeric(5, 2),
  location extensions.geography(Point, 4326),
  distance_from_establishment_meters numeric(10, 2),
  offline_generated boolean not null default false,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  constraint impressions_idempotency_unique unique (device_id, client_event_id),
  constraint impressions_period_check check (completed_at is null or completed_at >= started_at),
  constraint impressions_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint impressions_completion_check check (
    completion_percentage is null or completion_percentage between 0 and 100
  ),
  constraint impressions_distance_check check (
    distance_from_establishment_meters is null or distance_from_establishment_meters >= 0
  )
);

create index impressions_campaign_started_at_idx on public.impressions (campaign_id, started_at desc);
create index impressions_device_started_at_idx on public.impressions (device_id, started_at desc);
create index impressions_started_at_idx on public.impressions (started_at desc);
create index impressions_location_gist_idx on public.impressions using gist (location)
  where location is not null;

create table public.device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete restrict,
  recorded_at timestamptz not null,
  battery_level smallint,
  network_connected boolean not null,
  gps_available boolean not null,
  storage_free_bytes bigint,
  app_version text,
  location extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  constraint device_heartbeats_battery_check check (battery_level is null or battery_level between 0 and 100),
  constraint device_heartbeats_storage_check check (storage_free_bytes is null or storage_free_bytes >= 0)
);

create index device_heartbeats_device_recorded_at_idx
  on public.device_heartbeats (device_id, recorded_at desc);
create index device_heartbeats_recorded_at_idx
  on public.device_heartbeats (recorded_at desc);
create index device_heartbeats_location_gist_idx
  on public.device_heartbeats using gist (location)
  where location is not null;

create table public.driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  device_id uuid references public.devices (id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status public.driver_session_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint driver_sessions_period_check check (ended_at is null or ended_at >= started_at),
  constraint driver_sessions_completed_check check (
    (status = 'active' and ended_at is null) or status <> 'active'
  )
);

create index driver_sessions_driver_started_at_idx
  on public.driver_sessions (driver_id, started_at desc);
create index driver_sessions_vehicle_started_at_idx
  on public.driver_sessions (vehicle_id, started_at desc);
create unique index driver_sessions_one_active_per_driver
  on public.driver_sessions (driver_id)
  where status = 'active';

comment on table public.impressions is
  'Proof-of-play events. device_id + client_event_id makes offline synchronization idempotent.';
comment on table public.device_heartbeats is
  'Initial operational telemetry stream; a separate generic telemetry table is intentionally deferred.';
