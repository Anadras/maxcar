# Pilot information architecture

During the pilot, the administrative experience is organized around two
real-world hubs rather than database tables.

## Client hub

`Clientes` is the commercial starting point. Opening a client exposes its
units, campaigns and campaign media. Establishments, geofences and campaigns
remain separate domain records for integrity, but are not separate concepts in
the main navigation.

## Pilot hub

`Pilotos` is the operational starting point. Opening a pilot exposes the linked
vehicle and tablet, with contextual actions to add or inspect either one.
Vehicles and devices remain separate domain records because they have distinct
lifecycles and telemetry, but they are not separate concepts in the main
navigation.

## Pilot deletion

The singleton `system_settings.pilot_mode` switch explicitly enables permanent
test-data deletion by `super_admin`. The UI requires current-password
reauthentication, the word `EXCLUIR` and a reason. Database functions remove
dependent pilot data deliberately and then write an immutable audit event.

Before commercial operation, pilot mode must be disabled in a reviewed,
versioned migration. Production deletion policy must then return to archival or
restricted deletion so proof-of-play and operational history cannot be erased.
