# MAXCAR Engineering Rules

## Product

- MAXCAR operates advertising tablets installed in vehicles.
- There are REGULAR and GEO campaigns.
- GEO campaigns never abruptly interrupt currently playing media.
- GEO campaigns enter a priority queue and are played only after the current media ends.
- After GEO playback the player returns to the regular schedule.
- The main navigation gives one-click direct access to every operational
  module (Campanhas, Dispositivos, Clientes, Motoristas, Veículos,
  Geofences) — see `apps/admin/components/app-shell.tsx`. An earlier hub-only
  design (Clientes/Pilotos as the only entry points, MAX-011's "Bloco A")
  was reverted after pilot usage showed operators needed direct access to
  fleet modules without an extra click through a hub concept; establishments
  and geofences remain reachable contextually from a client/campaign too, but
  always also have their own top-level entry.

## Architecture

- Android must remain offline-first.
- Advertisement media must never depend on streaming. Required media and rules are synchronized to local storage.
- Playback, GPS and geofence evaluation continue without connectivity; events queue locally and synchronize later.
- Business logic cannot live inside UI components.
- Do not rearchitect the project without justification and documentation.
- Prefer simple modular architecture over unnecessary abstraction.

## Database

- Every schema change requires a migration.
- PostGIS will be used for geographic features.
- Terrestrial coordinates use `geography(Point, 4326)` and require justified spatial indexes.
- Row Level Security is mandatory.
- Database changes must be version-controlled.
- New authenticated users always start with the `pending` role.
- Authorization must derive from `auth.uid()` and the persisted profile, never from a client-supplied role.
- Historical events must not be removed through accidental cascades.
- Offline events require stable client identifiers and idempotent ingestion.
- Active campaigns must retain their required creative and GEO structure.
- Permanent deletion of operational descendants is allowed only while the
  explicit `system_settings.pilot_mode` switch is enabled, only for
  `super_admin`, and only through audited SECURITY DEFINER functions.

## UX

- Never render fabricated live metrics (fake uptime %, fake "last updated"
  timestamps, fake notification counts). If a number isn't backed by a real
  query, don't show it as if it were.
- A screen that only shows a toast without persisting anything is worse than
  no screen — mark it read-only or remove the fake action instead.
- At least one active `super_admin` profile must always exist; both the app
  layer and a database trigger enforce this.

## Fleet

- Driver↔vehicle and vehicle↔device links are current 1:1 relationships
  enforced by database constraints, never by application-only checks.
- Device connection status (online/attention/offline) is derived from the
  latest heartbeat by a single business-rules function; never hardcode the
  time thresholds in components or queries.
- No anonymous heartbeat ingestion endpoint. Devices authenticate with an
  opaque bearer token issued at enrollment (never a Supabase Auth JWT); the
  `super_admin`-only, non-production simulator remains available for devices
  that aren't enrolled yet or have no physical hardware.
- A device never declares its own `device_id`. The server always derives it
  from the hash of the bearer token it received.

## Security

- Never expose `service_role` in frontend applications.
- `service_role` must never enter the Android app in any form — not in
  `BuildConfig`, resources, assets, source, or logs. The Android app only
  talks to Supabase through the device Edge Functions
  (`device-enroll`/`device-heartbeat`/`device-config`).
- Never commit secrets.
- Follow least privilege.
- Device credentials are hash-only at rest (both the enrollment code and the
  issued token), specific per device, and revocable from the panel at any
  time. The raw device token is never written to Room, DataStore, or a log
  line — only to Keystore-backed encrypted storage on the device.
- A network failure must never be treated as a device credential revocation;
  only an explicit auth rejection (401) from the server may clear it.
- Campaign media stays private; previews and device downloads use
  short-lived signed URLs, never a public URL. A signed URL is never
  persisted anywhere — not in Postgres, not in Room — only used once, in
  the sync cycle that fetched it.
- Storage object paths derive from persisted ownership and UUIDs, never user filenames.
- A device manifest returns only content that device is actually
  authorized to receive — an active, structurally-ready REGULAR campaign
  reachable by that device's own playlist or the pilot's global default.
  GEO campaigns never enter a playlist.

## TypeScript

- Strict mode is mandatory.
- Avoid `any`.
- Validate external data.
- Separate UI, business rules and data access.
- Supabase reads belong in `apps/admin/lib/data`; writes use validated Server Actions.
- Treat `proxy.ts` as an optimistic session boundary, never as the only authorization layer.
- Import `SUPABASE_SERVICE_ROLE_KEY` only from server-only modules.

## Android

- Kotlin native, offline-first.
- Use Room, Media3, WorkManager, Coroutines and Location Services.
- Synchronization must be resilient.
- Kiosk mode will eventually be required; Device Owner/Lock Task
  provisioning requires a factory reset and must never be run without
  explicit authorization — see
  `docs/architecture/ANDROID_PILOT_TABLET_SETUP.md`.
- No location or camera permission until the milestone that actually needs
  it (Location Engine). Don't request permissions ahead of the feature
  that uses them. Media downloads into app-private storage
  (`context.filesDir`), which needs no storage permission.
- The GEO/Location Engine is a separate milestone from the regular
  player/media pipeline — don't blend its scope into unrelated work.
- A downloaded media file is never played until its size and SHA-256 match
  the manifest exactly. A partially downloaded or hash-mismatched file is
  never renamed into the path the player reads from.
- The current media grade is never deleted before its replacement has
  fully downloaded and validated — see
  `docs/architecture/ANDROID_MEDIA_CACHE.md`.

## Testing

- Critical business rules require tests.
- Geographic logic requires unit tests.
- Synchronization requires tests.
- Database migrations require validation.
- RLS changes require isolation tests for pending, advertiser, driver and staff roles.

## UI

- Preserve the MAXCAR approved visual identity.
- The approved prototype is the initial visual reference.
- Do not replace it with generic templates.
- Reuse design tokens.
- Maintain responsiveness and accessibility.

## Git

- Commits should be small and coherent.
- Never commit secrets.
- Never force push.
- Never rewrite remote history without explicit instruction.
