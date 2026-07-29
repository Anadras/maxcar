# ADR 006 — Vínculos de frota e saúde por heartbeat

## Status

Aceito no MAX-005.

## Contexto

O painel precisa administrar motoristas, veículos e tablets antes de o
aplicativo Android existir. É preciso um jeito de representar "quem dirige o
quê" e "qual tablet está em qual carro" sem duplicar estado, e um jeito de
saber se um dispositivo está operando sem depender de um sinal que o Android
ainda não envia.

## Decisão

Motorista↔veículo e veículo↔dispositivo são vínculos 1:1 atuais, garantidos
por índices únicos parciais no PostgreSQL (`vehicles.driver_id`,
`devices.vehicle_id`), não por validação isolada no app. Histórico de
jornadas fica em `driver_sessions`, independente do vínculo atual.

Conexão do dispositivo não é gravada como estado paralelo. É derivada em
`getDeviceConnectionStatus` (`packages/business-rules`) a partir do
`device_heartbeats.recorded_at` mais recente: até 5 minutos é `online`, até 15
é `attention`, além disso ou sem heartbeat é `offline`. Dispositivos em
manutenção ou desativados são `inactive` independentemente do sinal. A regra
vive em um único lugar e é reaproveitada por listagem, detalhe e dashboard.

Como o tablet ainda não tem identidade/autenticação própria (MAX-006), a
geração de heartbeat de teste passa por uma RPC `SECURITY INVOKER` restrita a
`super_admin` e recusada em produção, nunca por um endpoint anônimo.

## Consequências

- trocar o motorista de um veículo ou o tablet de um carro é uma escrita
  simples (RLS + constraint), sem tabela de vínculo separada;
- se um vínculo N:N ou histórico de instalação for necessário no futuro, isso
  é uma migração nova e documentada, não uma extensão do 1:1 atual;
- qualquer ajuste nos limiares de conexão muda um único arquivo testado, não
  cada tela que exibe status;
- a saúde exibida hoje reflete apenas o simulador administrativo até o
  Android existir; heartbeats reais dependerão da identidade do dispositivo
  do MAX-006/MAX-009.
