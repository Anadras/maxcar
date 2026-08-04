# MAXCAR — Localização (MAX-008)

Como o tablet sabe onde o carro está. Cobre permissões, o wrapper do Fused
Location Provider e o serviço em primeiro plano que o mantém vivo. Para o
que a localização dispara (geofences, fila GEO, cooldown), veja
[ANDROID_GEO_ENGINE.md](ANDROID_GEO_ENGINE.md).

## Permissões

`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`, pedidas uma vez no
`onCreate` do `MainActivity` (`registerForActivityResult` +
`ActivityResultContracts.RequestMultiplePermissions`), sem tela de "decidir
depois": o piloto não tem uso para o app sem localização. Uma negação não
trava o app — o player REGULAR continua funcionando normalmente, só o GEO
fica inativo, refletido em `GeoStatus.permissionGranted = false` no painel.

**Deliberadamente sem `ACCESS_BACKGROUND_LOCATION`.** O player roda como
uma experiência contínua em primeiro plano (o app nunca é "fechado" durante
a operação normal — ver [ANDROID_PLAYER.md](ANDROID_PLAYER.md)), então um
`Foreground Service` já garante localização enquanto o tablet está
operacional, sem o escrutínio adicional do Play Console e a barreira de
confiança mais alta que a permissão de background exige. Se um cenário
futuro precisar de localização com o app truly backgrounded, isso é uma
decisão de produto separada, não um ajuste técnico incremental.

## `LocationEngine`

`geo/LocationEngine.kt` — wrapper fino sobre
`com.google.android.gms.location.FusedLocationProviderClient`
(`play-services-location`). Único ponto de contato com a API do Google;
nada além dele conhece `LocationRequest`/`LocationCallback`.

- `Priority.PRIORITY_HIGH_ACCURACY`, intervalo de atualização de 15s
  (mínimo 10s) — cadência adequada para pegar a entrada num raio de
  100-300m em velocidade de rua sem drenar bateria de um tablet que já
  divide energia com tela e downloads.
- **Fixações imprecisas são descartadas na origem**: qualquer
  `location.accuracy > 50m` nunca chega ao `GeoEngine`
  (`LocationEngine.MAX_ACCEPTABLE_ACCURACY_METERS`). Tudo a partir desse
  ponto assume uma precisão já compatível com raios de geofence pequenos.
- `hasPermission()` centraliza a checagem (`ContextCompat.checkSelfPermission`)
  — nem `start()` nem qualquer chamador precisa reimplementá-la.

## `LocationForegroundService`

`geo/LocationForegroundService.kt` — existe só para satisfazer os limites
de execução em segundo plano do Android (agravados no Android 15) para
atualizações contínuas de localização; toda a lógica real vive em
`GeoEngine`, chamado no `onStartCommand`/`onDestroy` do serviço.

- Notificação de importância `LOW`, sempre presente (`setOngoing(true)`)
  enquanto o serviço roda — mínima, sem ações, sem permitir dispensar o
  player pela notificação.
- `foregroundServiceType="location"` no manifest (exigido a partir do
  Android 14).
- Ciclo de vida amarrado ao modo kiosk: `MainActivity.applyKioskMode` inicia
  o serviço quando o player vira a tela ativa e para quando sai para
  diagnóstico — GPS nunca roda escondido atrás da tela de diagnóstico.

## O que nunca é retido

Nenhuma fixação de localização é persistida como está — `GeoEngine` só
mantém a última fixação em memória (`GeoStatus`, para o painel) e o que a
máquina de estados decidiu (entrada/saída de geofence, essas sim
persistidas como eventos). Não existe histórico de rota, nem associação com
identidade de passageiro — ver a seção de minimização de dados em
[ANDROID_GEO_ENGINE.md](ANDROID_GEO_ENGINE.md#minimização-de-dados-lgpd).
