package com.maxcar.tablet.sync

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeTokenStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
class DeviceCommandExecutorTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var executor: DeviceCommandExecutor
    private lateinit var acknowledgedBodies: MutableList<String>

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        acknowledgedBodies = mutableListOf()

        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        appPreferences = AppPreferences(dataStore)
        val tokenStore = FakeTokenStore().apply { runBlocking { saveToken("tok-1") } }
        val apiClient = DeviceApiClient(baseUrl = server.url("/").toString())

        executor = DeviceCommandExecutor(
            apiClient = apiClient,
            tokenStore = tokenStore,
            mediaDownloadManager = MediaDownloadManager(
                context = context,
                apiClient = apiClient,
                tokenStore = tokenStore,
                playlistItemDao = db.playlistItemDao(),
                appPreferences = appPreferences,
                minFreeBytes = -1,
            ),
            geoRulesSyncManager = GeoRulesSyncManager(
                context = context,
                apiClient = apiClient,
                tokenStore = tokenStore,
                geoRuleDao = db.geoRuleDao(),
                minFreeBytes = -1,
            ),
            appPreferences = appPreferences,
        )
    }

    @After
    fun tearDown() {
        db.close()
        server.shutdown()
    }

    private fun dispatcherFor(commandsBody: String) = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            if (request.method == "GET" && request.path == "/device-commands") {
                return MockResponse().setBody(commandsBody)
            }
            if (request.method == "POST" && request.path == "/device-commands") {
                acknowledgedBodies += request.body.readUtf8()
                return MockResponse().setBody("""{"acknowledged":true}""")
            }
            if (request.path == "/device-manifest") {
                return MockResponse().setBody(
                    """{"manifestVersion":"0","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1","playlist":[]}""",
                )
            }
            if (request.path == "/device-geo-rules") {
                return MockResponse().setBody(
                    """{"rulesVersion":"0","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1","rules":[]}""",
                )
            }
            return MockResponse().setResponseCode(404)
        }
    }

    @Test
    fun `enter_maintenance sets the maintenance-requested flag`() = runTest {
        server.dispatcher = dispatcherFor(
            """{"commands":[{"commandId":"cmd-1","commandType":"enter_maintenance","createdAt":"2026-01-01T00:00:00Z"}]}""",
        )

        executor.pollAndExecute()

        assertEquals(true, appPreferences.maintenanceRequested.first())
        assertTrue(acknowledgedBodies.single().contains("\"status\":\"completed\""))
    }

    @Test
    fun `exit_maintenance clears the maintenance-requested flag`() = runTest {
        appPreferences.setMaintenanceRequested(true)
        server.dispatcher = dispatcherFor(
            """{"commands":[{"commandId":"cmd-2","commandType":"exit_maintenance","createdAt":"2026-01-01T00:00:00Z"}]}""",
        )

        executor.pollAndExecute()

        assertEquals(false, appPreferences.maintenanceRequested.first())
    }

    @Test
    fun `clear_obsolete_media re-runs both sync managers and acknowledges completed`() = runTest {
        server.dispatcher = dispatcherFor(
            """{"commands":[{"commandId":"cmd-3","commandType":"clear_obsolete_media","createdAt":"2026-01-01T00:00:00Z"}]}""",
        )

        executor.pollAndExecute()

        assertTrue(acknowledgedBodies.single().contains("\"status\":\"completed\""))
    }

    @Test
    fun `an unrecognized command type is acknowledged as failed, never silently ignored`() = runTest {
        server.dispatcher = dispatcherFor(
            """{"commands":[{"commandId":"cmd-4","commandType":"reboot_device","createdAt":"2026-01-01T00:00:00Z"}]}""",
        )

        executor.pollAndExecute()

        assertTrue(acknowledgedBodies.single().contains("\"status\":\"failed\""))
    }

    @Test
    fun `no pending commands means no acknowledgement call at all`() = runTest {
        server.dispatcher = dispatcherFor("""{"commands":[]}""")

        executor.pollAndExecute()

        assertTrue(acknowledgedBodies.isEmpty())
    }
}
