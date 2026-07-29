# MAXCAR Engineering Rules

## Product

- MAXCAR operates advertising tablets installed in vehicles.
- There are REGULAR and GEO campaigns.
- GEO campaigns never abruptly interrupt currently playing media.
- GEO campaigns enter a priority queue and are played only after the current media ends.
- After GEO playback the player returns to the regular schedule.

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
- No anonymous heartbeat ingestion endpoint. Device identity and
  authentication ship in a later milestone; until then, heartbeats come only
  from the `super_admin`-only, non-production simulator.

## Security

- Never expose `service_role` in frontend applications.
- Never commit secrets.
- Follow least privilege.
- Device credentials must eventually be revocable.
- Campaign media stays private; previews use short-lived signed URLs.
- Storage object paths derive from persisted ownership and UUIDs, never user filenames.

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
- Kiosk mode will eventually be required.

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
