# MAXCAR — Fluxo operacional e UX (MAX-005.5)

Este documento descreve como as áreas do painel se conectam para que uma
pessoa da operação consiga trabalhar sem abrir o Supabase, sem digitar UUID e
sem descobrir sozinha qual é o próximo passo.

## Fluxo operacional de ponta a ponta

```
Cliente
  └─ Estabelecimento (hub GEO)
       └─ Campanha (REGULAR ou GEO)
            └─ Criativo
            └─ Geofence (se GEO)
                 └─ Ativação
Motorista
  └─ Veículo
       └─ Dispositivo (tablet)
            └─ Monitoramento
```

## Cliente como hub

`/clientes/[id]` mostra os dados do anunciante e, na mesma tela, a lista de
estabelecimentos e campanhas daquele cliente (`lib/data/establishments.ts`
`listEstablishmentsByAdvertiser`, `lib/data/campaigns.ts` `listCampaigns`
com filtro `advertiserId`). Ações rápidas no cabeçalho já pré-selecionam o
cliente ao criar um estabelecimento (`/estabelecimentos/novo?advertiser=`) ou
uma campanha (`/campanhas/nova?advertiser=`).

## Estabelecimento como hub GEO

`/estabelecimentos/[id]` mostra o cliente (com link de volta), um mapa real
(ver abaixo) e as geofences/campanhas GEO associadas
(`lib/data/geofences.ts` `listGeofencesForEstablishment`). Ações rápidas
pré-selecionam o cliente e o tipo GEO ao criar uma campanha
(`/campanhas/nova?advertiser=&type=geo`) e pré-selecionam o estabelecimento
ao criar uma geofence (`/geofences/nova?establishment=`).

## Mapa real

`components/location-map.tsx` usa Leaflet (tiles OpenStreetMap) com um
`divIcon` próprio em vez do marcador padrão do Leaflet — o marcador padrão
resolve caminhos de imagem relativos ao path da página, o que sob o
bundler do Next colide com as rotas dinâmicas (`/estabelecimentos/[id]`
tentava interpretar `marker-icon.png` como um `id`). O componente só roda no
cliente (`components/location-map-loader.tsx` usa `next/dynamic` com
`ssr: false`) e é usado no detalhe de estabelecimento (marcador) e de
geofence (marcador + círculo do raio).

## Readiness de campanha

A prontidão estrutural (`campaignReadinessIssues`/`isCampaignStructurallyReady`
de `packages/business-rules`) é a mesma regra usada pelo trigger do banco
(`private.campaign_is_structurally_ready`). O componente compartilhado
`components/readiness-banner.tsx` exibe o mesmo banner ("✓ pronta" ou a lista
do que falta) tanto no detalhe da campanha quanto no formulário de edição —
antes o formulário só mostrava um aviso genérico. O formulário de criação não
mostra readiness porque criativos/geofences só existem depois que a campanha
é salva pela primeira vez.

## Frota como fluxo único

- Motorista → Veículo → Dispositivo é navegável nos dois sentidos; a página
  do motorista mostra o tablet do veículo vinculado (dois graus de
  distância), não só o veículo.
- Criar veículo a partir do motorista (`/veiculos/novo?driver=`) e criar
  dispositivo a partir do veículo (`/dispositivos/novo?vehicle=`)
  pré-selecionam o vínculo, no mesmo padrão usado por campanhas.
- Ações rápidas contextuais aparecem apenas quando fazem sentido: "＋
  Adicionar veículo" só quando o motorista não tem veículo; "＋ Instalar
  tablet" só quando o veículo não tem dispositivo.

## Monitoramento

`/dispositivos` abre com um resumo "O que precisa de atenção agora"
(dispositivos offline, em atenção, com bateria baixa, sem veículo, veículos
ativos sem tablet) calculado a partir de `getDeviceConnectionStatus` — cada
item é um link para a lista já filtrada. Quando não há nenhum ponto crítico,
mostra uma mensagem positiva em vez de uma seção vazia.

## Dashboard

As métricas são agrupadas em três seções — Comercial, Frota e Saúde do
sistema — e cada card é um link para a lista filtrada correspondente
(`MetricCard` aceita `href`). O "mapa operacional" e o modal de detalhe de
veículo agora mostram somente telemetria real do dispositivo selecionado
(bateria, rede, GPS, último heartbeat); antes o modal exibia "GPS: Saudável"
e "Último heartbeat: Agora" fixos, independentemente do dispositivo clicado.

## Navegação

- `components/breadcrumbs.tsx` é usado nas páginas hub e de detalhe
  (clientes, estabelecimentos, campanhas, geofences, motoristas, veículos,
  dispositivos), sempre terminando no registro atual.
- A sidebar (`components/app-shell.tsx`) tem quatro grupos: Visão geral,
  Comercial (Clientes, Estabelecimentos, Campanhas, Geofences), Operação
  (Motoristas, Veículos, Dispositivos, Tablet/Player) e Administração
  (Relatórios, Usuários, Perfil, Configurações).
- A topbar mostrava "REDE OPERACIONAL 98,7%", "Última atualização: agora" e
  um sino de notificações com contagem fixa "3" — nenhum dado real por trás.
  Foi substituída por um indicador honesto do ambiente atual
  (`NEXT_PUBLIC_APP_ENV`).

## Usuários e onboarding

O trigger `handle_new_auth_user` cria o profile `pending` automaticamente
(coberto por pgTAP em `supabase/tests/005_fleet_management_and_monitoring.test.sql`).
Um novo achado crítico deste marco: nada impedia remover ou desativar o
último `super_admin` ativo. A migration
`20260729090000_operational_integrity_and_ux.sql` adiciona um trigger
(`profiles_protect_last_super_admin`) que bloqueia update/delete que deixaria
zero super_admins ativos; a Server Action de usuários faz a mesma checagem
antes, para dar uma mensagem amigável em vez do erro do banco. Testado em
`supabase/tests/006_operational_integrity.test.sql`.

## Áreas conscientemente não "reais"

- **Configurações**: virou somente leitura (ambiente, fuso, o que ainda está
  por vir). O botão "Salvar" antigo mostrava um toast de sucesso sem
  persistir nada.
- **Relatórios**: os números de reprodução/impressão eram inteiramente
  fictícios (nenhum dado de reprodução existe até o Android existir). A
  página agora mostra um estado "Em breve" explicando a dependência, sem
  números fabricados.
- **Tablet / Player**: continua sendo uma simulação, já claramente rotulada
  como demonstração desde o MAX-001; nenhuma mudança necessária além de
  preservar esse rótulo.

## Dados de demonstração

O staging (Supabase Cloud) estava vazio (0 linhas em todas as tabelas de
negócio, exceto o super_admin real). Foi criado um conjunto `DEMO -`
pequeno e coerente: 1 cliente, 2 estabelecimentos, 1 campanha REGULAR e 1
GEO (ambas ativas, com criativo real enviado ao Storage), 1 geofence, 2
motoristas, 2 veículos e 2 tablets (`TB-DEMO01`, `TB-DEMO02`), com um
heartbeat real simulado para `TB-DEMO01` para demonstrar o status "online".
Nenhum dado real de cliente existia antes; nada foi substituído.
