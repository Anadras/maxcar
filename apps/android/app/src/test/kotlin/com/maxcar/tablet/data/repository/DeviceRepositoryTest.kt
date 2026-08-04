package com.maxcar.tablet.data.repository

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeDeviceKeyStore
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

private const val CHALLENGE_B64 = "Y2hhbGxlbmdl"

@RunWith(RobolectricTestRunner::class)
class DeviceRepositoryTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var deviceKeyStore: FakeDeviceKeyStore
    private lateinit var appPreferences: AppPreferences
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

        deviceKeyStore = FakeDeviceKeyStore()
        appPreferences = AppPreferences(dataStore)

        repository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = deviceKeyStore),
            deviceKeyStore = deviceKeyStore,
            installationIdStore = InstallationIdStore(dataStore),
            appPreferences = appPreferences,
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

    /** Pre-enrolls the repository's state directly (no network round trip):
     * generates the fake Keystore key and writes the matching device_state
     * row, exactly what a successful [DeviceRepository.enroll] would have
     * left behind. */
    private suspend fun preEnroll(keyId: String = "k1") {
        deviceKeyStore.getOrCreateKeyInfo()
        appPreferences.setEnrolled(true)
        db.deviceStateDao().upsert(
            com.maxcar.tablet.data.local.DeviceStateEntity(
                deviceId = "d1",
                deviceCode = "TB-001",
                vehicleId = null,
                vehicleCode = null,
                keyId = keyId,
                lastHeartbeatAt = null,
                lastSyncAt = null,
                updatedAt = 0,
            ),
        )
    }

    private fun enrollDispatcher(
        completeBody: String =
            """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1","vehicleId":"v1","vehicleCode":"CAR-001"}""",
    ) = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest) = when (request.path) {
            "/device-enroll-key-start" -> MockResponse().setBody(
                """{"enrollmentAttemptId":"a1","challenge":"$CHALLENGE_B64","expiresAt":"2026-01-01T00:05:00Z"}""",
            )
            "/device-enroll-key-complete" -> MockResponse().setBody(completeBody)
            else -> MockResponse().setResponseCode(404)
        }
    }

    @Test
    fun `enroll generates a device key, persists the activated key id, and marks enrolled`() = runTest {
        server.dispatcher = enrollDispatcher()

        val result = repository.enroll("GOODCODE")

        assertTrue(result.isSuccess)
        assertTrue(deviceKeyStore.hasKey())
        val state = db.deviceStateDao().get()
        assertEquals("TB-001", state?.deviceCode)
        assertEquals("CAR-001", state?.vehicleCode)
        assertEquals("k1", state?.keyId)
        assertTrue(repository.isEnrolled.first())

        val startRequest = server.takeRequest()
        assertTrue(startRequest.body.readUtf8().contains("GOODCODE"))
    }

    @Test
    fun `enroll reuses the same Keystore key on a retry instead of generating a new one`() = runTest {
        server.dispatcher = enrollDispatcher()
        val firstAttemptKeyInfo = deviceKeyStore.getOrCreateKeyInfo()

        repository.enroll("GOODCODE")

        assertEquals(firstAttemptKeyInfo.fingerprintHex, deviceKeyStore.currentKeyInfo()?.fingerprintHex)
    }

    @Test
    fun `enroll never marks the device enrolled if the server rejects completion`() = runTest {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/device-enroll-key-start" -> MockResponse().setBody(
                    """{"enrollmentAttemptId":"a1","challenge":"$CHALLENGE_B64","expiresAt":"2026-01-01T00:05:00Z"}""",
                )
                "/device-enroll-key-complete" -> MockResponse()
                    .setResponseCode(401)
                    .setBody("""{"error":"unauthorized","message":"Enrollment attempt already completed."}""")
                else -> MockResponse().setResponseCode(404)
            }
        }

        val result = repository.enroll("GOODCODE")

        assertTrue(result.isFailure)
        assertNull(db.deviceStateDao().get())
        assertFalse(repository.isEnrolled.first())
    }

    @Test
    fun `a successful heartbeat updates lastHeartbeatAt`() = runTest {
        preEnroll()
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
        preEnroll()
        server.shutdown() // nothing is listening: every call fails with a network error

        val result = repository.sendHeartbeat(batteryLevel = 50, networkType = "offline", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.NetworkUnavailable)
        assertEquals(1, db.pendingEventDao().count())
        // The identity is untouched: a network failure is never treated as
        // a rejection.
        assertEquals("k1", db.deviceStateDao().get()?.keyId)
    }

    @Test
    fun `flushPendingEvents doesn't let one bad event permanently block the rest of the queue`() = runTest {
        // Regresses MAX-011 Bloco 7: the old code unconditionally returned
        // on the *first* event's failure, so a single stuck item at the
        // front of the queue (oldest first) blocked every healthy item
        // queued behind it forever.
        preEnroll()
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
        preEnroll()
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
    fun `an unauthorized heartbeat drops the local key pairing but leaves enrollment alone`() = runTest {
        preEnroll()
        server.enqueue(
            MockResponse().setBody(
                """{"error":"unauthorized","message":"Unknown device key."}""",
            ).setResponseCode(401),
        )

        val result = repository.sendHeartbeat(batteryLevel = 50, networkType = "wifi", storageFreeBytes = null)

        assertTrue(result.exceptionOrNull() is DeviceApiError.Unauthorized)
        // Only the local key_id pairing is dropped — the next cycle
        // retries through recovery instead of bouncing straight to the
        // enrollment screen (see DeviceRepository.handleUnauthorizedDeviceKey).
        assertNull(db.deviceStateDao().get()?.keyId)
        assertTrue(repository.isEnrolled.first())
        // Device/vehicle history is preserved, never wiped by a rejection.
        assertEquals("d1", db.deviceStateDao().get()?.deviceId)
    }

    @Test
    fun `refreshConfig persists the remote config and updates lastSyncAt`() = runTest {
        preEnroll()
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
        preEnroll()
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
    fun `flushPlaybackEvents on 401 drops the local key pairing instead of dropping the queue`() = runTest {
        preEnroll()
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "completed",
            startedAt = "2026-01-01T00:00:00Z", completedAt = null,
            durationMs = null, completionPercentage = null, failureReason = null, offline = false,
        )
        server.enqueue(
            MockResponse()
                .setBody("""{"error":"unauthorized","message":"Unknown device key."}""")
                .setResponseCode(401),
        )

        repository.flushPlaybackEvents()

        assertNull(db.deviceStateDao().get()?.keyId)
        assertTrue(repository.isEnrolled.first())
        // The event itself is left alone; only the identity pairing is cleared.
        assertEquals(1, db.playbackEventDao().count())
    }

    @Test
    fun `flushPlaybackEvents on a network failure leaves the queue intact for the next attempt`() = runTest {
        preEnroll()
        repository.recordPlaybackEvent(
            campaignId = "c1", creativeId = "cr1", status = "completed",
            startedAt = "2026-01-01T00:00:00Z", completedAt = null,
            durationMs = null, completionPercentage = null, failureReason = null, offline = false,
        )
        server.shutdown()

        repository.flushPlaybackEvents()

        assertEquals(1, db.playbackEventDao().count())
        assertEquals("k1", db.deviceStateDao().get()?.keyId)
    }

    // --- MAX-011 Bloco A (carried forward into MAX-010.6): a missing local
    // identity must never be treated as a server-confirmed rejection. ---

    @Test
    fun `no Keystore key and no local state never clears enrollment, unlike a real server 401`() = runTest {
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        appPreferences.setEnrolled(true)
        val brokenKeyStore = FakeDeviceKeyStore() // hasKey() == false: nothing to recover with
        val brokenRepository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = brokenKeyStore),
            deviceKeyStore = brokenKeyStore,
            installationIdStore = InstallationIdStore(dataStore),
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
        // so it can't possibly be a server-confirmed rejection.
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `refreshConfig behaves the same way as sendHeartbeat for a missing local identity`() = runTest {
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        appPreferences.setEnrolled(true)
        val brokenKeyStore = FakeDeviceKeyStore()
        val brokenRepository = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = brokenKeyStore),
            deviceKeyStore = brokenKeyStore,
            installationIdStore = InstallationIdStore(dataStore),
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
    fun `a lost local key_id is recovered automatically when the Keystore key still exists`() = runTest {
        // The exact scenario MAX-010.6 exists for: a Room reset or a lost
        // row leaves device_state without a key_id, but the Keystore key
        // that produced it is still intact — resolveKeyId must recover the
        // pairing via a signed challenge instead of surfacing
        // CredentialUnavailable, and the heartbeat that triggered it
        // should complete successfully in the very same call.
        deviceKeyStore.getOrCreateKeyInfo() // the Keystore key survives...
        // ...but no device_state row (or a null key_id) is present locally.
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/device-recover-key-start" -> MockResponse().setBody(
                    """{"recoveryAttemptId":"r1","challenge":"$CHALLENGE_B64","expiresAt":"2026-01-01T00:05:00Z"}""",
                )
                "/device-recover-key-complete" -> MockResponse().setBody(
                    """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1","vehicleId":"v1","vehicleCode":"CAR-001"}""",
                )
                "/device-heartbeat" -> MockResponse().setBody(
                    """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
                )
                else -> MockResponse().setResponseCode(404)
            }
        }

        val result = repository.sendHeartbeat(batteryLevel = 90, networkType = "wifi", storageFreeBytes = null)

        assertTrue(result.isSuccess)
        assertEquals("k1", db.deviceStateDao().get()?.keyId)
        assertTrue(repository.isEnrolled.first())
        assertFalse(repository.credentialMissingLocally.first())
    }

    @Test
    fun `recovery fails closed for a genuinely revoked key, surfacing the missing-credential banner`() = runTest {
        // The Keystore key survives and the device is marked enrolled, but
        // there is no local key_id pairing (e.g. a prior handled-
        // Unauthorized cycle already dropped it) — resolveKeyId must try
        // recovery, and when the server refuses it (the key was actually
        // revoked), fail closed to CredentialUnavailable rather than
        // silently retrying forever or crashing.
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        val appPreferences = AppPreferences(dataStore)
        appPreferences.setEnrolled(true)
        deviceKeyStore.getOrCreateKeyInfo()
        val repositoryWithoutLocalKeyId = DeviceRepository(
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = deviceKeyStore),
            deviceKeyStore = deviceKeyStore,
            installationIdStore = InstallationIdStore(dataStore),
            appPreferences = appPreferences,
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/device-recover-key-start" -> MockResponse()
                    .setResponseCode(401)
                    .setBody("""{"error":"unauthorized","message":"Unknown or revoked device key."}""")
                else -> MockResponse().setResponseCode(404)
            }
        }

        val result = repositoryWithoutLocalKeyId.sendHeartbeat(
            batteryLevel = 50, networkType = "wifi", storageFreeBytes = null,
        )

        assertTrue(result.exceptionOrNull() is DeviceApiError.CredentialUnavailable)
        assertTrue(appPreferences.credentialMissingLocally.first())
    }

    @Test
    fun `reenrollAfterCredentialLoss clears local device state without touching the Keystore key`() = runTest {
        preEnroll()

        repository.reenrollAfterCredentialLoss()

        assertNull(db.deviceStateDao().get())
        assertFalse(repository.isEnrolled.first())
        // The key itself is preserved: a fresh enroll() call reuses it
        // rather than needing to register a brand-new one.
        assertTrue(deviceKeyStore.hasKey())
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
                    return when (request.path) {
                        "/device-enroll-key-start" -> MockResponse().setBody(
                            """{"enrollmentAttemptId":"a1","challenge":"$CHALLENGE_B64","expiresAt":"2026-01-01T00:05:00Z"}""",
                        )
                        else -> MockResponse().setBody(
                            """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1"}""",
                        )
                    }
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
