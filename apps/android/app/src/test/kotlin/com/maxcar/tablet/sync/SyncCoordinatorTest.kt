package com.maxcar.tablet.sync

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeTokenStore
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.GeoRepository
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.geo.LocationEngine
import com.maxcar.tablet.kiosk.KioskLevelDetector
import com.maxcar.tablet.work.DeviceTelemetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID

/**
 * Exercises MAX-009's Sync Coordinator end to end against a single fake
 * server, the same integration style as [com.maxcar.tablet.data.repository.DeviceRepositoryTest] —
 * every dependency SyncCoordinator actually talks to is real, only the
 * network is faked, so this proves the coordinator's own ordering and
 * outcome-mapping logic rather than any one dependency in isolation
 * (each already has its own focused test suite).
 */
@RunWith(RobolectricTestRunner::class)
class SyncCoordinatorTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var tokenStore: FakeTokenStore
    private lateinit var coordinator: SyncCoordinator
    private lateinit var commandExecutor: DeviceCommandExecutor

    private val emptyManifest =
        """{"manifestVersion":"0","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1","playlist":[]}"""
    private val emptyGeoRules =
        """{"rulesVersion":"0","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1","rules":[]}"""
    private val emptyConfig =
        """{"deviceId":"d1","deviceCode":"TB-01","heartbeatIntervalSeconds":900,"syncIntervalSeconds":3600,"kioskEnabled":false,"loggingLevel":"info","configVersion":1}"""
    private val heartbeatOk =
        """{"deviceId":"d1","deviceCode":"TB-01","recordedAt":"2026-01-01T00:00:00Z"}"""

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()

        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        tokenStore = FakeTokenStore().apply { saveToken("tok-1") }
        val apiClient = DeviceApiClient(baseUrl = server.url("/").toString())

        val deviceRepository = DeviceRepository(
            apiClient = apiClient,
            installationIdStore = InstallationIdStore(dataStore),
            secureTokenStore = tokenStore,
            appPreferences = appPreferences,
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )
        val mediaDownloadManager = MediaDownloadManager(
            context = context,
            apiClient = apiClient,
            tokenStore = tokenStore,
            playlistItemDao = db.playlistItemDao(),
            appPreferences = appPreferences,
            minFreeBytes = -1,
        )
        val geoRulesSyncManager = GeoRulesSyncManager(
            context = context,
            apiClient = apiClient,
            tokenStore = tokenStore,
            geoRuleDao = db.geoRuleDao(),
            minFreeBytes = -1,
        )
        val geoRepository = GeoRepository(
            apiClient = apiClient,
            tokenStore = tokenStore,
            geofenceEventDao = db.geofenceEventDao(),
        )
        val geoEngine = GeoEngine(
            locationEngine = LocationEngine(context),
            geoRulesSyncManager = geoRulesSyncManager,
            geoRuleDao = db.geoRuleDao(),
            geofenceEventDao = db.geofenceEventDao(),
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        )
        commandExecutor = DeviceCommandExecutor(
            apiClient = apiClient,
            tokenStore = tokenStore,
            mediaDownloadManager = mediaDownloadManager,
            geoRulesSyncManager = geoRulesSyncManager,
            appPreferences = appPreferences,
        )

        coordinator = SyncCoordinator(
            deviceRepository = deviceRepository,
            mediaDownloadManager = mediaDownloadManager,
            geoRulesSyncManager = geoRulesSyncManager,
            geoRepository = geoRepository,
            geoEngine = geoEngine,
            commandExecutor = commandExecutor,
            appPreferences = appPreferences,
            kioskLevelDetector = KioskLevelDetector(context),
            telemetryProvider = { DeviceTelemetry(batteryLevel = 90, networkType = "wifi", storageFreeBytes = 5_000_000_000L) },
        )
    }

    @After
    fun tearDown() {
        db.close()
        runCatching { server.shutdown() }
    }

    private fun okDispatcher(commandsBody: String = """{"commands":[]}""") = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest) = when (request.path) {
            "/device-heartbeat" -> MockResponse().setBody(heartbeatOk)
            "/device-manifest" -> MockResponse().setBody(emptyManifest)
            "/device-geo-rules" -> MockResponse().setBody(emptyGeoRules)
            "/device-config" -> MockResponse().setBody(emptyConfig)
            "/device-commands" -> MockResponse().setBody(commandsBody)
            else -> MockResponse().setResponseCode(404)
        }
    }

    @Test
    fun `a fully successful cycle returns SUCCESS and touches every priority step`() = runTest {
        server.dispatcher = okDispatcher()

        val outcome = coordinator.runCycle()

        assertEquals(SyncOutcome.SUCCESS, outcome)
        val paths = (0 until server.requestCount).map { server.takeRequest().path }
        assertEquals(true, paths.contains("/device-heartbeat"))
        assertEquals(true, paths.contains("/device-manifest"))
        assertEquals(true, paths.contains("/device-geo-rules"))
        assertEquals(true, paths.contains("/device-commands"))
    }

    @Test
    fun `an unauthorized heartbeat stops the cycle immediately as UNAUTHORIZED`() = runTest {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/device-heartbeat" -> MockResponse()
                    .setResponseCode(401)
                    .setBody("""{"error":"unauthorized","message":"Invalid or revoked device credential."}""")
                else -> MockResponse().setResponseCode(404)
            }
        }

        val outcome = coordinator.runCycle()

        assertEquals(SyncOutcome.UNAUTHORIZED, outcome)
        // Nothing past the heartbeat should have been attempted.
        val paths = (0 until server.requestCount).map { server.takeRequest().path }
        assertEquals(false, paths.contains("/device-manifest"))
        assertEquals(false, paths.contains("/device-commands"))
    }

    @Test
    fun `an offline device returns SUCCESS rather than a retryable failure`() = runTest {
        server.shutdown() // Nothing answers any request from here on.

        val outcome = coordinator.runCycle()

        assertEquals(SyncOutcome.SUCCESS, outcome)
    }

    @Test
    fun `a pending restart_player command is executed and emits the restart signal`() = runTest {
        server.dispatcher = okDispatcher(
            commandsBody = """{"commands":[{"commandId":"cmd-1","commandType":"restart_player","createdAt":"2026-01-01T00:00:00Z"}]}""",
        )

        commandExecutor.restartPlayerSignal.test {
            coordinator.runCycle()
            assertEquals(Unit, awaitItem())
        }

        val ackRequest = (0 until server.requestCount)
            .map { server.takeRequest() }
            .first { it.method == "POST" && it.path == "/device-commands" }
        assertEquals(true, ackRequest.body.readUtf8().contains("\"status\":\"completed\""))
    }
}
