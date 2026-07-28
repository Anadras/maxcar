# MAXCAR — Produto

## Problema

Publicidade em mobilidade costuma depender de inventário pouco mensurável e oferece pouca capacidade de contextualização local. Ao mesmo tempo, uma rede de tablets embarcados não pode parar quando a conexão móvel oscila.

## Solução

MAXCAR distribui mídia previamente sincronizada para tablets Android instalados em veículos. O painel web administra campanhas, clientes, estabelecimentos, frota e dispositivos; o futuro aplicativo Android executará a programação localmente, avaliará geofences e sincronizará eventos quando houver conectividade.

## Grade normal

A grade regular roda continuamente e combina publicidade, conteúdo Midiamax, campanhas institucionais, notícias e informações úteis. Os arquivos são locais no dispositivo e nenhuma peça publicitária depende de streaming.

## Campanhas GEO

Uma campanha GEO associa um estabelecimento físico a latitude, longitude, raio, período, horário, prioridade, frequência e cooldown. Quando o veículo entra em uma área válida, a campanha se torna elegível.

## Fluxo da fila

1. A mídia atual continua até o fim.
2. A campanha GEO elegível entra na próxima posição prioritária.
3. A campanha GEO é reproduzida e a impressão é registrada localmente.
4. O player retorna à grade regular.

A entrada na geofence nunca interrompe abruptamente a mídia em reprodução e não substitui permanentemente a grade.

## Painel

O painel acompanha campanhas, clientes, estabelecimentos, veículos, motoristas, tablets, zonas GEO, reproduções e disponibilidade. MAX-001 usa dados demonstrativos isolados para validar a experiência antes do backend.

## Aplicativo Android

O aplicativo futuro será nativo em Kotlin, offline-first e operará em modo quiosque. Room manterá dados locais; Media3 executará mídia; WorkManager e Coroutines coordenarão sincronização; Location Services alimentará a avaliação local de geofences.

## Públicos e casos de uso

- Operação: acompanha saúde da rede e resolve incidentes.
- Comercial: apresenta inventário e resultados a anunciantes.
- Anunciante: contrata grade ampla ou ativações por proximidade.
- Motorista: mantém o tablet operando no veículo sem gerir conteúdo.
- Gestão: avalia disponibilidade, alcance e desempenho por campanha.

## Objetivos do piloto

- Validar estabilidade do player e da sincronização offline.
- Medir disponibilidade por veículo e qualidade de GPS.
- Confirmar a compreensão e o valor comercial da ativação GEO.
- Validar o fluxo operacional em Campo Grande antes de expandir.

## Evolução

MAX-002 adicionará Supabase, PostgreSQL, PostGIS, migrations e RLS. Marcos posteriores entregarão autenticação, storage, sincronização, aplicativo Android, telemetria, mapas reais e analytics.
