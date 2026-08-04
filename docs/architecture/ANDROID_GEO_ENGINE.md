# MAXCAR — Motor GEO (MAX-008)

Como o tablet decide, sozinho e offline, que uma campanha GEO deve entrar
na fila — e como ela entra sem nunca interromper o que já está tocando.
Para a origem da localização, veja
[ANDROID_LOCATION.md](ANDROID_LOCATION.md). Para como a campanha GEO chega
ao servidor e é sincronizada, veja
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md) e a RPC
`get_device_geo_rules` (migration MAX-008).

## Uma única classe coordenadora

`geo/GeoEngine.kt` é o único ponto que conecta localização, regras GEO
offline, a máquina de estados de geofence e a fila de prioridade. Ele nunca
decide _quando_ tocar — só expõe `nextCandidate`, o melhor candidato GEO
elegível agora, se houver. Quem decide o momento seguro de inserir é
`PlayerViewModel` (ver [ANDROID_PLAYER.md](ANDROID_PLAYER.md#geo)).

## Regras offline (`GeoRuleEntity`)

Espelha exatamente `PlaylistItemEntity` (mesma disciplina de
download/hash/troca atômica — ver
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md)), mas chaveado por
`geofenceId` (`campaign_geofences.id`), não por criativo: uma campanha pode
ter várias geofences em estabelecimentos diferentes.
`GeoRulesSyncManager.kt` é o download manager irmão de
`MediaDownloadManager`, contra `context.filesDir/geo_media/` em vez de
`media/` — mesma lógica, diretório e tabela Room separados porque um
criativo pode ser usado por uma campanha REGULAR enquanto outro é
GEO-exclusivo, e as duas grades evoluem independentemente. **Nenhum
streaming GEO existe**: a campanha só toca depois de baixada e validada
localmente, exatamente como REGULAR.

`GeoRuleEntity.lastTriggeredAtMillis` é o próprio relógio de cooldown,
persistido no Room — sobrevive a reinício do app e a reboot do tablet
(item 15 do MAX-008), escrito só quando a campanha GEO **realmente começa a
tocar** (`GeoEngine.onGeoPlayed`), nunca na mera entrada na geofence.

## Distância real

`GeoDistance.haversineMeters` (`geo/GeofenceStateMachine.kt`) — fórmula do
grande círculo, não uma aproximação de pixel/mapa. Matemática pura, sem
dependência do framework Android, então testável em JUnit puro sem
Robolectric (`GeofenceStateMachineTest`).

## Máquina de estados e histerese

`GeofenceStateMachine` mantém um estado por geofence: `OUTSIDE` ou
`INSIDE`.

- **Entrada**: dispara quando `distância <= radiusMeters`.
- **Saída**: só dispara quando `distância >= radiusMeters + margem`
  (`exitMarginMeters`, padrão 15m).

A margem de saída é o que evita o carro "piscar" entrada/saída/entrada
parado bem na borda do raio por ruído do GPS. Uma geofence continuamente
`INSIDE` nunca reemite `enter` a cada leitura de localização — só as bordas
`OUTSIDE→INSIDE` e `INSIDE→OUTSIDE` produzem uma transição, que vira um
`GeofenceEventEntity` local (fila offline, sincronizada via
`GeoRepository.flushGeofenceEvents` para `/device-geofence-events`, mesmo
padrão idempotente por `clientEventId` de `PlaybackEventEntity`).

## Fila de prioridade — fórmula determinística

Quando o veículo está simultaneamente dentro de mais de uma geofence
elegível (cooldown já liberado, campanha ativa), `GeoPriorityScorer`
decide qual toca com uma cadeia fixa de comparação — **nunca aleatório**:

1. Maior `priority` (override da geofence vence o padrão da campanha — ver
   `get_device_geo_rules`).
2. Menor distância até o estabelecimento.
3. Horário de entrada mais antigo (quem entrou primeiro tem prioridade
   sobre quem entrou um instante depois).
4. `geofenceId` em ordem lexicográfica — desempate final, garante um
   resultado reproduzível mesmo se todos os critérios acima empatarem
   exatamente.

Coberto por `GeoPriorityScorerTest`, incluindo um teste que roda a mesma
seleção repetidamente para provar que o resultado nunca varia.

## Cooldown e limite de repetição

- **Cooldown por geofence**: `rule.cooldownSeconds` (override da geofence
  ou padrão da campanha), medido a partir de `lastTriggeredAtMillis` — uma
  geofence em cooldown nunca entra como candidata (`GeoEngine.updateCandidate`).
- **No máximo 1 GEO consecutiva**: não é uma flag separada — é uma
  consequência estrutural de onde o candidato é oferecido. Ver
  [ANDROID_PLAYER.md](ANDROID_PLAYER.md#geo).

## Minimização de dados (LGPD)

- Nenhuma fixação de localização crua é persistida — só as **transições**
  de geofence (entrada/saída/permanência), com a localização daquele
  instante, nunca uma trilha contínua.
- Sem histórico de rota: `GeofenceEventEntity` é apagado localmente assim
  que sincronizado com sucesso (mesma retenção limitada de
  `PlaybackEventEntity`, 7 dias como teto se ficar offline por muito
  tempo).
- Sem associação com identidade de passageiro: o evento carrega
  `deviceId`/`geofenceId`/localização/distância — nunca um identificador de
  pessoa.
- Painel mostra localização detalhada só para papéis autorizados
  (`super_admin`/`admin`/`operations`) — ver
  [DEVICE_MONITORING.md](DEVICE_MONITORING.md).

## Ferramenta de simulação (apenas debug)

`DeviceHomeViewModel.simulateGeoLocation` → `GeoEngine.simulateLocation` —
injeta uma fixação falsa pelo **mesmo caminho** de avaliação que uma
localização real usa (máquina de estados, cooldown, fila de prioridade
todos exercitados de verdade). Só alcançável a partir de
`DeviceHomeScreen` atrás de `if (BuildConfig.DEBUG)` — inexistente em
build de release. Todo evento simulado marca `GeoStatus.simulated = true`,
exibido como "(SIMULADO)" onde quer que apareça, nunca confundível com uma
localização real.

## Testes de bancada antes do carro

1. Simular localização perto de uma geofence de teste cadastrada no painel.
2. Confirmar entrada (`enter` registrado, candidato aparece).
3. Confirmar que a campanha GEO só entra depois que o item REGULAR atual
   termina.
4. Confirmar retomada da grade REGULAR logo depois.
5. Simular saída — confirmar `exit` registrado, sem novo disparo enquanto
   ainda dentro do cooldown.
