# MAXCAR — Frota e monitoramento

## Escopo do MAX-005

Motoristas, veículos, dispositivos e heartbeats são persistidos no Supabase e
exibidos pelo painel administrativo. Este marco não cria identidade de
dispositivo, aplicativo Android, sincronização, kiosk mode ou ingestão pública.

## Modelo e vínculos

- `drivers` contém a identidade operacional e usa status em vez de exclusão.
- `vehicles.driver_id` é opcional e único quando preenchido: um motorista pode
  estar vinculado a no máximo um veículo atual.
- `devices.vehicle_id` é opcional e único quando preenchido: um veículo pode
  receber no máximo um tablet atual.
- `driver_sessions` preserva o histórico de jornadas independentemente do
  vínculo atual.
- `device_heartbeats` é histórico imutável de sinais operacionais.

Placas aceitam os formatos legado (`ABC1234`) e Mercosul (`ABC1D23`). O app
remove pontuação e converte para maiúsculas; um trigger repete a normalização e
validação no banco. Códigos `CAR-*` e `TB-*` também são normalizados.

## Saúde do dispositivo

O status de conexão não é gravado como verdade paralela. Ele é calculado com o
último `device_heartbeats.recorded_at`:

- `online`: sinal de até 5 minutos;
- `attention`: mais de 5 e até 15 minutos;
- `offline`: mais de 15 minutos, data inválida ou nenhum heartbeat;
- `inactive`: dispositivo em manutenção ou desativado.

O campo `devices.status` continua representando o ciclo operacional. Bateria,
rede e GPS são indicadores independentes e não alteram a janela de conexão.

## Acesso e RLS

`super_admin`, `admin` e `operations` leem e gerenciam a frota. `commercial` e
`advertiser` não recebem linhas de frota. O perfil `driver` lê somente seu
motorista, veículo, dispositivo, sessões e heartbeats associados; o painel web
continua indisponível para esse papel.

As views `driver_admin_view`, `vehicle_admin_view` e
`device_monitoring_view` usam `security_invoker`, portanto preservam as
políticas das tabelas-base. O app usa as tabelas diretamente para manter os
tipos gerados compatíveis durante o ciclo incremental de migrations.

## Simulador

`simulate_device_heartbeat` cria um sinal real no banco, atualiza
`devices.last_seen_at` e valida coordenadas WGS84. A função é `security
invoker`, exige `super_admin` e depende da política de insert do heartbeat. A
Server Action e o botão também recusam produção. Ela é uma ferramenta de
validação local, não uma API para o futuro Android.

## Trigger de profiles

`handle_new_auth_user` foi recriado com owner `postgres`, `search_path` vazio,
papel inicial `pending` e `on conflict do nothing`. O trigger em `auth.users`
também foi recriado e o pgTAP confirma a criação automática do perfil e a
cópia opcional do nome. Isso corrige de forma idempotente a lacuna observada
durante o diagnóstico de Auth.

## Execução local

Com Docker Desktop ativo:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run dev
```

O seed cria três conjuntos fictícios de motorista, veículo e dispositivo com
heartbeats nas janelas online, atenção e offline.
