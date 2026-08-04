# Pilot information architecture

The administrative experience gives one-click direct access to every
operational module — see `apps/admin/components/app-shell.tsx`:

- **PRINCIPAL**: Início, Campanhas, Dispositivos, Clientes, Motoristas,
  Veículos, Geofences.
- **OPERAÇÃO**: Relatórios, Auditoria.
- **ADMINISTRAÇÃO**: Usuários, Configurações, Meu perfil.

No fleet module (Campanhas, Dispositivos, Motoristas, Veículos, Geofences)
lives behind a hub or a submenu — every one of them is a direct top-level
link.

## Revision history

An earlier design (MAX pilot simplification marco) organized the panel
around two hubs instead — "Clientes" (units, campaigns, media) and
"Pilotos" (driver, vehicle, tablet) — with the individual fleet tables
demoted to secondary/contextual screens. That hub-only navigation was
**reverted** (MAX-011 Bloco E) after real pilot usage showed operators
needed direct, one-click access to Dispositivos/Motoristas/Veículos/
Geofences without an extra click through a hub concept, especially while
diagnosing a specific tablet in the field. Establishments and geofences
remain reachable contextually from inside a client or campaign too — that
convenience was kept — but they also always have their own top-level entry
now.

## Pilot deletion

The singleton `system_settings.pilot_mode` switch explicitly enables permanent
test-data deletion by `super_admin`. The UI requires current-password
reauthentication, the word `EXCLUIR` and a reason. Database functions remove
dependent pilot data deliberately and then write an immutable audit event.

Before commercial operation, pilot mode must be disabled in a reviewed,
versioned migration. Production deletion policy must then return to archival or
restricted deletion so proof-of-play and operational history cannot be erased.
