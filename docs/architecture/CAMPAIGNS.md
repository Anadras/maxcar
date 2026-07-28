# MAXCAR — Campanhas e geofences

## Escopo do MAX-004

O painel administra campanhas `REGULAR` e `GEO` com dados reais do Supabase.
Server Components fazem leituras pela camada `apps/admin/lib/data`; toda escrita
passa por Server Action, validação Zod, autorização por perfil e RLS.

Uma campanha reúne anunciante, período absoluto, janela diária, dias ativos,
prioridade, cooldown e limite diário opcional. A prioridade amigável da
interface é persistida no campo numérico existente: baixa `20`, normal `50`,
alta `70` e premium `90`.

## Ciclo e prontidão

Campanhas novas são criadas como rascunho ou em outro estado não ativo. A
ativação é protegida no banco:

- toda campanha ativa precisa de período válido, ao menos um dia ativo e um
  criativo ativo;
- uma campanha `GEO` também precisa de ao menos uma geofence ativa;
- uma campanha `REGULAR` não pode receber geofence;
- a campanha e o estabelecimento da geofence precisam pertencer ao mesmo
  anunciante;
- uma campanha ativa não pode perder seu último criativo ou, quando `GEO`, sua
  última geofence.

Essas invariantes vivem em triggers para valer em qualquer cliente do banco. A
UI usa as mesmas regras puras de `packages/business-rules` para explicar o que
falta antes da ativação.

## Programação e fuso

Períodos são armazenados como `timestamptz`; janelas diárias como `time`; dias
ativos seguem o array `smallint[]` já existente, de domingo `0` a sábado `6`.
O formulário exige que o operador escolha o fuso e converte o horário civil
para um instante absoluto. A simulação usa por padrão
`America/Campo_Grande`, informado explicitamente à RPC.

## Geofences

`campaign_geofences` referencia `establishments.location`; a posição não é
duplicada. O painel permite configurar raio, prioridade e cooldown opcionais,
estado e uma visualização conceitual do círculo. O ponto só pode ser alterado
no cadastro do estabelecimento.

`simulate_geofence_eligibility` é uma RPC `SECURITY INVOKER`. Ela valida
latitude, longitude e timezone, usa `ST_Distance` sobre
`geography(Point, 4326)` e retorna distância, pertencimento ao raio e
elegibilidade. A elegibilidade considera campanha ativa, tipo `GEO`, período,
dia, horário, geofence, estabelecimento e criativo ativos. A RLS das tabelas
continua definindo quais geofences o usuário pode consultar.

Cooldown por dispositivo, deduplicação, frequência e decisão offline pertencem
ao futuro motor do tablet. A simulação administrativa não antecipa esse motor.
