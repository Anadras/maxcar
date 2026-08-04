package com.maxcar.tablet.data.repository

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeTokenStore
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.newSingleThreadContext
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
class DeviceRepositoryTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var tokenStore: FakeTokenStore
    private lateinit var repository: DeviceRepository

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
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }

        tokenStore = FakeTokenStore()

        repository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString()),
            installationIdStore = InstallationIdStore(dataStore),
            secureTokenStore = tokenStore,
            appPreferences = AppPreferences(dataStore),
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )
    }

    @After
    fun tearDown() {
        db.close()
        server.shutdown()
    }

    @Test
    fun `enroll persists device state, saves the token and marks enrolled`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceToken":"tok-1","deviceId":"d1","deviceCode":"TB-001","vehicleId":"v1","vehicleCode":"CAR-001"}""",
            ),
        )

        val result = repository.enroll("GOODCODE")

        assertTrue(result.isSuccess)
        assertEquals("tok-1", tokenStore.readToken())
        val state = db.deviceStateDao().get()
        assertEquals("TB-001", state?.deviceCode)
        assertEquals("CAR-001", state?.vehicleCode)
        assertTrue(repository.isEnrolled.first())
    }

    @Test
    fun `a successful heartbeat updates lastHeartbeatAt`() = runTest {
        tokenStore.saveToken("tok-1")
        db.deviceStateDao().upsert(
            com.maxcar.tablet.data.local.DeviceStateEntity(
                deviceId = "d1",
                deviceCode = "TB-001",
                vehicleId = null,
                vehicleCode = null,
                lastHeartbeatAt = null,
                lastSyncAt = null,
                updatedAt = 0,
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
            ),
        )

        val result = repository.sendHeartbeat(batteryLevel = 80, networkType = "wifi", storageFreeBytes = 1000)

        assertTrue(result.isSuccess)
        assertEquals("2026-01-01T00:00:00Z", db.deviceStateDao().get()?.lastHeartbeatAt)
    }

    @Test
    fun `a heartbeat that can't reach the server is queued, not dropped`() = runTest {
        tokenStore.saveToken("tok-1")
        server.shutdown() // nothing is listening: every call fails with a network error

        val result = repository.sendHeartbeat(batteryLevel = 50, networkType = "offline", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.NetworkUnavailable)
        assertEquals(1, db.pendingEventDao().count())
        // The credential is untouched: a network failure is never treated
        // as a revocation.
        assertNotNull(tokenStore.readToken())
    }

    @Test
    fun `flushPendingEvents doesn't let one bad event permanently block the rest of the queue`() = runTest {
        // Regresses MAX-011 Bloco 7: the old code unconditionally returned
        // on the *first* event's failure, so a single stuck item at the
        // front of the queue (oldest first) blocked every healthy item
        // queued behind it forever.
        tokenStore.saveToken("tok-1")
        val now = System.currentTimeMillis()
        db.pendingEventDao().insert(
            com.maxcar.tablet.data.local.PendingEventEntity(
                clientEventId = "poison-event",
                batteryLevel = 10, networkType = "wifi", storageFreeBytes = null,
                appVersion = "0.1.0", deviceTimeMillis = 0, createdAt = now - 2000,
            ),
        )
        db.pendingEventDao().insert(
            com.maxcar.tablet.data.local.PendingEventEntity(
                clientEventId = "healthy-event",
                batteryLevel = 20, networkType = "wifi", storageFreeBytes = null,
                appVersion = "0.1.0", deviceTimeMillis = 0, createdAt = now - 1000,
            ),
        )
        var requestCount = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requestCount++
                return if (requestCount == 1) {
                    MockResponse().setResponseCode(500).setBody("server error")
                } else {
                    MockResponse().setBody(
                        """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
                    )
                }
            }
        }

        repository.flushPendingEvents()

        // The poison event is still queued (not silently dropped) with its
        // attempt recorded, but the healthy one behind it was still tried
        // and succeeded in the same pass.
        assertEquals(1, db.pendingEventDao().count())
        assertEquals("poison-event", db.pendingEventDao().oldest().first().clientEventId)
        assertEquals(1, db.pendingEventDao().oldest().first().attemptCount)
        assertEquals(2, requestCount)
    }

    @Test
    fun `flushPendingEvents delivers a queued heartbeat once the server is reachable again`() = runTest {
        tokenStore.saveToken("tok-1")
        db.pendingEventDao().insert(
            com.maxcar.tablet.data.local.PendingEventEntity(
                clientEventId = "queued-1",
                batteryLevel = 42,
                networkType = "wifi",
                storageFreeBytes = null,
                appVersion = "0.1.0",
                deviceTimeMillis = 0,
                createdAt = System.currentTimeMillis(),
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
            ),
        )

        repository.flushPendingEvents()

        assertEquals(0, db.pendingEventDao().count())
    }

    @Test
    fun `an unauthorized heartbeat clears the credential and marks the device as not enrolled`() = runTest {
        tokenStore.saveToken("tok-1")
        server.enqueue(
            MockResponse().setBody(
                """{"error":"unauthorized","message":"Invalid or revoked device credential."}""",
            ).setResponseCode(401),
        )

        val result = repository.sendHeartbeat(batteryLevel = 50, networkType = "wifi", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.Unauthorized)
        assertNull(tokenStore.readToken())
        assertFalse(repository.isEnrolled.first())
    }

    @Test
    fun `refreshConfig persists the remote config and updates lastSyncAt`() = runTest {
        tokenStore.saveToken("tok-1")
        db.deviceStateDao().upsert(
            com.maxcar.tablet.data.local.DeviceStateEntity(
                deviceId = "d1",
                deviceCode = "TB-001",
                vehicleId = null,
                vehicleCode = null,
                lastHeartbeatAt = null,
                lastSyncAt = null,
                updatedAt = 0,
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","heartbeatIntervalSeconds":600,
                   |"syncIntervalSeconds":1800,"kioskEnabled":true,"loggingLevel":"debug","configVersion":2}
                """.trimMargin(),
            ),
        )

        val result = repository.refreshConfig()

        assertTrue(result.isSuccess)
        assertEquals(600, db.remoteConfigDao().get()?.heartbeatIntervalSeconds)
        assertEquals(2, db.remoteConfigDao().get()?.configVersion)
        assertNotNull(db.deviceStateDao().get()?.lastSyncAt)
    }

    @Test
    fun `recordPlaybackEvent queues locally without touching the network`() = runTest {
        val id = repository.recordPlaybackEvent(
            campaignId = "c1",
            creativeId = "cr1",
            status = "completed",
            startedAt = "2026-01-01T00:00:00Z",
            completedAt = "2026-01-01T00:00:10Z",
            durationMs = 10_000,
            completionPercentage = 100,
            failureReason = null,
            offline = false,
        )

        assertEquals(1, db.playbackEventDao().count())
        assertEquals(id.toString(), db.playbackEventDao().oldest().first().clientEventId)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `flushPlaybackEvents removes only the events the server confirmed`() = runTest {
        tokenStore.saveToken("tok-1")
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "completed",
            startedAt = "2026-01-01T00:00:00Z", completedAt = "2026-01-01T00:00:10Z",
            durationMs = 10_000, completionPercentage = 100, failureReason = null, offline = false,
            clientEventId = UUID.fromString("00000000-0000-0000-0000-000000000001"),
        )
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "failed",
            startedAt = "2026-01-01T00:01:00Z", completedAt = "2026-01-01T00:01:05Z",
            durationMs = 5_000, completionPercentage = null, failureReason = "decode_error", offline = false,
            clientEventId = UUID.fromString("00000000-0000-0000-0000-000000000002"),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"results":[
                   |{"clientEventId":"00000000-0000-0000-0000-000000000001","ok":true,"recorded":true},
                   |{"clientEventId":"00000000-0000-0000-0000-000000000002","ok":false}]}
                """.trimMargin(),
            ),
        )

        repository.flushPlaybackEvents()

        assertEquals(1, db.playbackEventDao().count())
        assertEquals(
            "00000000-0000-0000-0000-000000000002",
            db.playbackEventDao().oldest().first().clientEventId,
        )
    }

    @Test
    fun `flushPlaybackEvents on 401 revokes the credential instead of dropping the queue`() = runTest {
        tokenStore.saveToken("tok-1")
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "completed",
            startedAt = "2026-01-01T00:00:00Z", completedAt = null,
            durationMs = null, completionPercentage = null, failureReason = null, offline = false,
        )
        server.enqueue(
            MockResponse()
                .setBody("""{"error":"unauthorized","message":"Invalid or revoked device credential."}""")
                .setResponseCode(401),
        )

        repository.flushPlaybackEvents()

        assertNull(tokenStore.readToken())
        assertFalse(repository.isEnrolled.first())
        // The event itself is left alone; only the credential is cleared.
        assertEquals(1, db.playbackEventDao().count())
    }

    @Test
    fun `flushPlaybackEvents on a network failure leaves the queue intact for the next attempt`() = runTest {
        tokenStore.saveToken("tok-1")
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "completed",
            startedAt = "2026-01-01T00:00:00Z", completedAt = null,
            durationMs = null, completionPercentage = null, failureReason = null, offline = false,
        )
        server.shutdown()

        repository.flushPlaybackEvents()

        assertEquals(1, db.playbackEventDao().count())
        assertNotNull(tokenStore.readToken())
    }

    // --- MAX-011 Bloco A: a missing local credential must never be treated
    // as a server-confirmed revocation. Regresses the "tablet keeps asking
    // for a new activation code" bug: DeviceRepository.sendHeartbeat/
    // refreshConfig used to throw a *self-synthesized*
    // DeviceApiError.Unauthorized whenever the local token store returned
    // null (Keystore hiccup, a not-yet-flushed write, anything) — and the
    // very same handler that reacts to a real server 401 caught that too,
    // silently clearing `isEnrolled` on a purely local read failure with no
    // server round trip at all. ---

    @Test
    fun `a locally unreadable credential never clears enrollment, unlike a real server 401`() = runTest {
        // Simulates enrollment being marked true (e.g. by a prior
        // successful enroll()) while the token itself is, for whatever
        // reason, unreadable right now — the exact state a Keystore fault
        // or an interrupted write can produce.
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        appPreferences.setEnrolled(true)
        val brokenTokenStore = FakeTokenStore() // never had saveToken() called: readToken() == null
        val brokenRepository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString()),
            installationIdStore = InstallationIdStore(dataStore),
            secureTokenStore = brokenTokenStore,
            appPreferences = appPreferences,
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )

        val result = brokenRepository.sendHeartbeat(batteryLevel = 50, networkType = "wifi", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.CredentialUnavailable)
        // The critical assertion: still enrolled. The old bug cleared this.
        assertTrue(appPreferences.isEnrolled.first())
        assertTrue(appPreferences.credentialMissingLocally.first())
        // No network call was ever made — this never reached the server,
        // so it can't possibly be a server-confirmed revocation.
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `refreshConfig behaves the same way as sendHeartbeat for a missing local credential`() = runTest {
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        appPreferences.setEnrolled(true)
        val brokenRepository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString()),
            installationIdStore = InstallationIdStore(dataStore),
            secureTokenStore = FakeTokenStore(),
            appPreferences = appPreferences,
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )

        val result = brokenRepository.refreshConfig()

        assertTrue(result.exceptionOrNull() is DeviceApiError.CredentialUnavailable)
        assertTrue(appPreferences.isEnrolled.first())
    }

    @Test
    fun `a real server 401 still clears enrollment exactly as before`() = runTest {
        // The other half of the regression: fixing the false-positive path
        // must not weaken the true-positive one.
        tokenStore.saveToken("tok-1")
        server.enqueue(
            MockResponse()
                .setBody("""{"error":"unauthorized","message":"Invalid or revoked device credential."}""")
                .setResponseCode(401),
        )

        val result = repository.sendHeartbeat(batteryLevel = 50, networkType = "wifi", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.Unauthorized)
        assertNull(tokenStore.readToken())
        assertFalse(repository.isEnrolled.first())
    }

    @Test
    fun `reenrollAfterCredentialLoss is the only path back to the enrollment screen after a local fault`() = runTest {
        tokenStore.saveToken("tok-1")

        repository.reenrollAfterCredentialLoss()

        assertNull(tokenStore.readToken())
        assertFalse(repository.isEnrolled.first())
    }

    @OptIn(DelicateCoroutinesApi::class, ExperimentalCoroutinesApi::class)
    @Test
    fun `enroll runs the blocking network call off the calling (Main) dispatcher`() = runTest {
        // Regresses the tablet activation bug: DeviceApiClient blocks the
        // calling thread (OkHttp's synchronous execute()), and callers
        // reach DeviceRepository from viewModelScope, whose default
        // dispatcher is Main. On a real device, running the HTTP call on
        // that thread throws NetworkOnMainThreadException on every attempt
        // — Robolectric doesn't enforce that policy, so this test instead
        // asserts directly that the call never runs on the "Main" thread.
        val mainThread = newSingleThreadContext("test-main")
        Dispatchers.setMain(mainThread)
        try {
            var callThreadName: String? = null
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    callThreadName = Thread.currentThread().name
                    return MockResponse().setBody(
                        """{"deviceToken":"tok-1","deviceId":"d1","deviceCode":"TB-001"}""",
                    )
                }
            }

            val result = withContext(Dispatchers.Main) { repository.enroll("GOODCODE") }

            assertTrue(result.isSuccess)
            assertNotNull(callThreadName)
            assertNotEquals("test-main", callThreadName)
        } finally {
            Dispatchers.resetMain()
            mainThread.close()
        }
    }
}
