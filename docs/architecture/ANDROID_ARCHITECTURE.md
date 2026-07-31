# MAXCAR — Arquitetura do aplicativo Android

Cobre `apps/android`, o projeto Gradle nativo introduzido no MAX-006. Este
marco entrega apenas a fundação do tablet — identidade, ativação, credencial e
heartbeat. Player, mídia, GEO e localização em segundo plano ficam para
MAX-007/008; veja [ANDROID_ENROLLMENT.md](ANDROID_ENROLLMENT.md),
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
│   └── repository/ DeviceRepository — único ponto que conhece as regras
├── domain/         DeviceApiError (erros de domínio, nunca stack trace na UI)
├── work/           WorkManager: HeartbeatWorker, InitialSyncWorker, scheduler
├── ui/
│   ├── enrollment/ tela + ViewModel de ativação
│   ├── home/       tela + ViewModel de diagnóstico do dispositivo
│   └── theme/      MaxcarTheme (dark only, espelha o painel web)
└── di/             AppContainer — fiação manual
```

`DeviceRepository` (`data/repository/DeviceRepository.kt`) é a única classe
que decide o que uma falha de rede, uma revogação ou um heartbeat bem-sucedido
significam para o estado local. UI e `WorkManager` sempre passam por ela;
nenhum dos dois chama `DeviceApiClient` ou os DAOs diretamente.

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

## Permissões

Só `INTERNET` e `ACCESS_NETWORK_STATE`
(`app/src/main/AndroidManifest.xml`). Nenhuma permissão de localização,
câmera ou armazenamento é solicitada neste marco — GPS e geofencing chegam
junto do player em MAX-007/008.

## Testes

`./gradlew :app:testStagingDebugUnitTest` roda 17 testes JVM:

- `DeviceApiClientTest` (6): contrato HTTP via `MockWebServer`, sem
  Robolectric — cobre sucesso, 401, 429, e confirma que o token nunca aparece
  no corpo da requisição de heartbeat.
- `InstallationIdStoreTest` (2), `DeviceRepositoryTest` (5): via
  `RobolectricTestRunner`, com Room em memória, `DataStore` em arquivo
  temporário e um `FakeTokenStore` (Robolectric não tem uma AndroidKeyStore
  utilizável, então `SecureTokenStore` — o `TokenStore` real — não é
  exercitado nesses testes; ele é coberto por revisão de código e pelo build
  real do APK).
- `DeviceWorkSchedulerTest` (4): via `WorkManagerTestInitHelper`, cobre o
  clamp para o mínimo de 15 minutos do `PeriodicWork`, os nomes únicos de
  trabalho e o cancelamento.

`app/src/test/resources/robolectric.properties` fixa `sdk=36`: a versão mais
nova que o Robolectric 4.16 entende, uma abaixo do `targetSdk=37` do projeto
(exigido por dependências AndroidX mais novas). Nenhum teste depende de
comportamento específico da API 37.

`./gradlew :app:lintStagingDebug` roda sem erros. Os avisos atuais (recursos
de cor não referenciados pelo Compose, sugestão de KSP em vez de kapt, e
detalhes menores de manifest) são de baixo risco e não bloqueiam o build;
revisitar quando o player consumir a paleta de cores ou quando Room adotar
KSP.

## O que não está aqui

Media3, playlist local, Location Engine, geofencing, modo kiosk e qualquer
persistência de mídia continuam fora do escopo — ver `AGENTS.md` e o
planejamento em [ARCHITECTURE.md](ARCHITECTURE.md#planejado--android-offline-first).
