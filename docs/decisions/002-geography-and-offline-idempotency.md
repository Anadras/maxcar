# ADR-002 — Geography e idempotência offline

- Status: Aceita
- Data: 2026-07-28

## Contexto

Distâncias terrestres precisam ser expressas em metros e tablets podem reenviar eventos após períodos offline.

## Decisão

Usar `geography(Point, 4326)` com índices GIST para posições. Em `impressions`, exigir `client_event_id` UUID e unicidade composta com `device_id`.

## Consequências

- `ST_DWithin` e `ST_Distance` operam diretamente em metros.
- O mesmo evento de um dispositivo não gera duas provas de reprodução.
- O cliente precisa persistir o UUID antes da primeira tentativa de sincronização.
