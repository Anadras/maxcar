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
- Row Level Security is mandatory.
- Database changes must be version-controlled.

## Security

- Never expose `service_role` in frontend applications.
- Never commit secrets.
- Follow least privilege.
- Device credentials must eventually be revocable.

## TypeScript

- Strict mode is mandatory.
- Avoid `any`.
- Validate external data.
- Separate UI, business rules and data access.

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
