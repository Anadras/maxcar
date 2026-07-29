# MAXCAR — Monitoramento de dispositivos

Complementa [FLEET.md](FLEET.md), que descreve o modelo de dados, os vínculos
e a regra de saúde. Este documento cobre a experiência operacional do
monitoramento no painel administrativo.

## Painel de dispositivos

`/dispositivos` lista todos os tablets com o vínculo atual (veículo e
motorista) e a conexão calculada a partir do heartbeat mais recente. A busca
filtra por código do tablet, placa ou nome do motorista; os seletores filtram
por conexão (`online`, `attention`, `offline`, `inactive`) e por vínculo
(com ou sem veículo). Todos os filtros são combináveis e vivem em
`lib/data/devices.ts`, sem query builder na UI.

## Detalhe do dispositivo

`/dispositivos/[id]` mostra o veículo e motorista vinculados, o estado
operacional (`devices.status`), a conexão derivada e as últimas 20 leituras de
`device_heartbeats` (horário, bateria, rede, GPS e versão do app). Localização
(quando presente) é exibida apenas para `super_admin`/`admin`/`operations`,
nunca para `advertiser`.

## Dashboard

`getDashboardCounts` (`lib/data/dashboard.ts`) soma motoristas e veículos
ativos e reaproveita `listDevices()` para contar dispositivos por conexão. Os
números continuam ao lado das métricas reais de MAX-004 (clientes,
estabelecimentos, campanhas e GEO); nenhuma métrica de frota usa dado
demonstrativo.

## Regra de conexão

A classificação online/atenção/offline/inativo vive exclusivamente em
`getDeviceConnectionStatus` (`packages/business-rules`), coberta por testes
Vitest. Nem os componentes nem as queries repetem os limites de 5 e 15
minutos — eles apenas leem o resultado da função.

## Simulação de heartbeat

`simulateHeartbeat` (`app/(protected)/dispositivos/actions.ts`) chama a RPC
`simulate_device_heartbeat`, restrita a `super_admin` e recusada em produção
(`NODE_ENV === 'production'`). É a única forma de gerar sinal antes do
Android existir; não há endpoint público ou uso de `service_role`.

## Fora deste marco

Mapa em tempo real, histórico geográfico, alertas automatizados por ausência
de heartbeat e ingestão a partir do tablet real ficam para o MAX-006, quando o
dispositivo terá identidade e autenticação próprias.
