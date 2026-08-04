# MAXCAR — Arquitetura do aplicativo Android

Cobre `apps/android`, o projeto Gradle nativo introduzido no MAX-006. O
MAX-006 entregou a fundação do tablet — identidade, ativação, credencial e
heartbeat. O MAX-007 acrescenta o player regular offline-first: manifesto,
download/cache de mídia, reprodução em tela cheia e eventos de reprodução —
veja [ANDROID_PLAYER.md](ANDROID_PLAYER.md),
[ANDROID_MEDIA_SYNC.md](ANDROID_MEDIA_SYNC.md),
[ANDROID_MEDIA_CACHE.md](ANDROID_MEDIA_CACHE.md) e
[ANDROID_PLAYBACK_EVENTS.md](ANDROID_PLAYBACK_EVENTS.md). GPS e o motor GEO
ficam para MAX-008; veja também [ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md),
[ANDROID_OFFLINE_FIRST.md](ANDROID_OFFLINE_FIRST.md) e
[DEVICE_SECURITY.md](DEVICE_SECURITY.md).

## Módulo único

`apps/android` tem um único módulo Gradle (`:app`), Kotlin + Jetpack Compose,
sem framework de injeção de dependência: `di/AppContainer.kt` constrói e
expõe as dependências manualmente a partir de `MaxcarApplication`. O projeto
é pequeno o bastante para isso ser mais legível que Hilt; revisitar só se o
grafo de objetos crescer a ponto de a fiação manual virar ruído.

## Camadas

```text
com.maxcar.tablet/
├── data/
│   ├── local/     # DataStore, EncryptedSharedPreferences, Room (entities + DAOs)
│   ├── remote/     DeviceApiClient (OkHttp), DTOs (kotlinx.serialization)
│   └── repository/ DeviceRepository (identidade/heartbeat/eventos) e
│                    MediaDownloadManager (manifesto/download/cache)
├── domain/         DeviceApiError (erros de domínio, nunca stack trace na UI)
├── work/           WorkManager: HeartbeatWorker, InitialSyncWorker,
│                    MediaSyncWorker, BootCompletedReceiver, scheduler
├── ui/
│   ├── enrollment/ tela + ViewModel de ativação
│   ├── home/       tela + ViewModel de diagnóstico do dispositivo
│   ├── player/      tela + ViewModel do player regular (MAX-007)
│   └── theme/      MaxcarTheme (dark only, espelha o painel web)
└── di/             AppContainer — fiação manual
```

`DeviceRepository` (`data/repository/DeviceRepository.kt`) decide o que uma
falha de rede, uma revogação, um heartbeat ou um evento de reprodução
significam para o estado local — identidade, telemetria e proof-of-play.
`MediaDownloadManager` (`data/repository/MediaDownloadManager.kt`) é a
classe irmã, dona só do ciclo manifesto → download → cache → grade local;
separada porque é um domínio de dados e de I/O em disco genuinamente
diferente, não uma extensão do que `DeviceRepository` já fazia. UI e
`WorkManager` sempre passam por uma das duas, nunca por `DeviceApiClient`
ou os DAOs diretamente. Ver [ADR 008](../decisions/008-media-manifest-and-offline-player.md).

## Build

- `com.android.application` 9.3.1 + `org.jetbrains.kotlin.android` 2.3.21
  (não o Kotlin embutido do AGP 9 — veja
  [ADR 007](../decisions/007-device-identity-and-enrollment.md) e o
  comentário em `build.gradle.kts` sobre por que a versão do Kotlin está
  presa em 2.3.x).
- `compileSdk`/`targetSdk` 37; `minSdk` 26.
- Duas flavors na dimensão `environment`: `staging` e `production`, cada uma
  com seu próprio `DEVICE_API_BASE_URL` via `BuildConfig` (hoje apontam para
  o mesmo projeto Supabase; a separação existe para o dia em que houver um
  projeto de produção distinto).
- Room usa `kapt`, não KSP: o processador do Room 2.8.4 lê o `@Metadata` do
  Kotlin via `kotlin-metadata-jvm` e entende no máximo a versão 2.3.0; tanto
  kapt quanto KSP passam pelo mesmo processador, então a causa raiz é a
  versão do Kotlin, não o backend de annotation processing.
- Media3 (`media3-exoplayer`, `media3-ui`) 1.10.1, a última versão estável
  no momento do MAX-007 (1.11.x ainda em RC).

## Permissões

`INTERNET`, `ACCESS_NETWORK_STATE` e, a partir do MAX-007,
`RECEIVE_BOOT_COMPLETED` (auto-start do player após reiniciar o tablet —
ver [ANDROID_PLAYER.md](ANDROID_PLAYER.md#auto-start-após-reboot))
(`app/src/main/AndroidManifest.xml`). Mídia baixa para armazenamento
privado do app (`filesDir`), sem exigir permissão de armazenamento. Nenhuma
permissão de localização ou câmera é solicitada — GPS e geofencing chegam
com o Location Engine em MAX-008.

## Testes

`./gradlew :app:testStagingDebugUnitTest` roda 34 testes JVM:

- `DeviceApiClientTest` (11): contrato HTTP via `MockWebServer`, sem
  Robolectric — enroll/heartbeat/config/manifest/playback-events, 401, 429,
  download streaming, e confirma que o token nunca aparece no corpo da
  requisição.
- `InstallationIdStoreTest` (2), `DeviceRepositoryTest` (11),
  `MediaDownloadManagerTest` (6): via `RobolectricTestRunner`, com Room em
  memória, `DataStore` em arquivo temporário e um `FakeTokenStore`
  (Robolectric não tem uma AndroidKeyStore utilizável, então
  `SecureTokenStore` — o `TokenStore` real — não é exercitado nesses
  testes; ele é coberto por revisão de código e pelo build real do APK).
  `MediaDownloadManagerTest` cobre download+hash válido, hash inválido
  (nunca fica `READY`, `.tmp` removido), não-redownload de item já pronto,
  troca atômica de grade, armazenamento insuficiente e revogação em 401.
- `DeviceWorkSchedulerTest` (4): via `WorkManagerTestInitHelper`, cobre o
  clamp para o mínimo de 15 minutos do `PeriodicWork`, os nomes únicos de
  trabalho e o cancelamento.

`app/src/test/resources/robolectric.properties` fixa `sdk=36`: a versão mais
nova que o Robolectric 4.16 entende, uma abaixo do `targetSdk=37` do projeto
(exigido por dependências AndroidX mais novas). Nenhum teste depende de
comportamento específico da API 37.

`./gradlew :app:lintStagingDebug` roda sem erros. Uso de API instável do
Media3 (`PlayerView`, `AspectRatioFrameLayout`) precisa de
`@androidx.annotation.OptIn(markerClass = UnstableApi::class)` — não o
`kotlin.OptIn` embutido, que o lint do Media3 não reconhece — aplicado numa
função dedicada (`createPlayerView`) para que a anotação valha no local
exato que o lint analisa, não só na função Composable que a chama. Os
demais avisos atuais (recursos de cor não referenciados pelo Compose,
sugestão de KSP em vez de kapt, detalhes menores de manifest) são de baixo
risco e não bloqueiam o build.

## O que não está aqui

Location Engine, geofencing, GPS em segundo plano, Device Owner/MDM
corporativo completo, atualização remota do APK e relatórios administrativos
avançados continuam fora do escopo — ver `AGENTS.md`,
[ANDROID_PILOT_TABLET_SETUP.md](ANDROID_PILOT_TABLET_SETUP.md#device-owner-avaliado-não-ativado)
e o planejamento em [ARCHITECTURE.md](ARCHITECTURE.md#planejado--android-offline-first).
