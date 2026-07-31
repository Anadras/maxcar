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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}
