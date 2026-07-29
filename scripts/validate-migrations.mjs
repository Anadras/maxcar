import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationDirectory = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (migrationFiles.length < 9) {
  throw new Error(
    `Expected the 6 MAX-002 migrations plus incremental changes, found ${migrationFiles.length}.`,
  );
}

const sql = migrationFiles
  .map((file) => readFileSync(join(migrationDirectory, file), 'utf8'))
  .join('\n')
  .toLowerCase();

const tables = [
  'profiles',
  'advertisers',
  'establishments',
  'drivers',
  'vehicles',
  'devices',
  'campaigns',
  'campaign_creatives',
  'campaign_geofences',
  'playlists',
  'playlist_items',
  'geofence_events',
  'impressions',
  'device_heartbeats',
  'driver_sessions',
];

for (const table of tables) {
  if (!sql.includes(`create table public.${table}`)) {
    throw new Error(`Missing table migration: ${table}.`);
  }
  if (!sql.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`RLS is not enabled for: ${table}.`);
  }
}

const requiredFragments = [
  'create extension if not exists postgis',
  'geography(point, 4326)',
  'using gist (location)',
  'constraint impressions_idempotency_unique unique (device_id, client_event_id)',
  'constraint campaign_geofences_radius_check check',
  'constraint impressions_completion_check check',
  'security definer',
  "new.raw_user_meta_data ->> 'full_name'",
  "'pending'",
  'insert into storage.buckets',
  'create policy profiles_super_admin_write',
  'create policy profiles_admin_update',
  'create or replace function public.save_establishment',
  'create or replace function public.update_own_profile_name',
  'with (security_invoker = true)',
  'create or replace function private.campaign_is_structurally_ready',
  'create or replace function public.simulate_geofence_eligibility',
  'create policy campaign_media_authenticated_read',
  'create policy campaign_media_commercial_insert',
  'file_size_limit = 52428800',
  'create unique index vehicles_one_driver_unique',
  'create unique index devices_one_vehicle_unique',
  'create view public.device_monitoring_view',
  'create policy device_heartbeats_super_admin_insert',
  'create or replace function public.simulate_device_heartbeat',
  'invalid brazilian license plate',
];

for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) {
    throw new Error(`Missing required database invariant: ${fragment}.`);
  }
}

const forbiddenFragments = [
  'disable row level security',
  'service_role key',
  'on delete cascade references public.campaigns',
];

for (const fragment of forbiddenFragments) {
  if (sql.includes(fragment)) {
    throw new Error(`Forbidden migration pattern found: ${fragment}.`);
  }
}

const seed = readFileSync(
  join(process.cwd(), 'supabase', 'seed', 'development.sql'),
  'utf8',
).toLowerCase();

if (!seed.includes('fake / development data')) {
  throw new Error('Development seed must be explicitly marked as fake data.');
}

console.log(
  `Validated ${migrationFiles.length} migrations, ${tables.length} RLS tables and the development seed.`,
);
