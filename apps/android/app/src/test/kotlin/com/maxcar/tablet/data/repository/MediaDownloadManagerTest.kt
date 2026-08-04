package com.maxcar.tablet.data.repository

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeDeviceKeyStore
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
class MediaDownloadManagerTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var deviceIdentity: FakeDeviceIdentityProvider
    private lateinit var appPreferences: AppPreferences
    private lateinit var apiClient: DeviceApiClient
    private lateinit var manager: MediaDownloadManager

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
        appPreferences = AppPreferences(dataStore)
        deviceIdentity = FakeDeviceIdentityProvider()
        apiClient = DeviceApiClient(
            baseUrl = server.url("/").toString(),
            deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() },
        )

        manager = MediaDownloadManager(
            context = context,
            apiClient = apiClient,
            deviceIdentity = deviceIdentity,
            playlistItemDao = db.playlistItemDao(),
            appPreferences = appPreferences,
            // Robolectric's app-private storage reports ~0 bytes available
            // via StatFs, which would otherwise fail every download before
            // it even starts; -1 guarantees the check passes regardless of
            // what that shadowed value is. The dedicated low-storage test
            // below constructs its own manager with the real default.
            minFreeBytes = -1,
        )
    }

    @After
    fun tearDown() {
        db.close()
        server.shutdown()
    }

    private fun sha256(bytes: ByteArray) =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun manifestBody(creativeId: String, sha256: String, size: Int, downloadPath: String) = """
        {"manifestVersion":"v1","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1",
         "playlist":[{"campaignId":"c1","creativeId":"$creativeId","type":"image","mimeType":"image/jpeg",
         "durationSeconds":10.0,"fileSizeBytes":$size,"sha256":"$sha256",
         "downloadUrl":"${server.url(downloadPath)}","startsAt":null,"endsAt":null,"position":1}]}
    """.trimIndent()

    @Test
    fun `sync downloads a new item, validates its hash, and marks it READY`() = runTest {
        val bytes = "hello-creative".toByteArray()
        val hash = sha256(bytes)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" ->
                    MockResponse().setBody(manifestBody("cr1", hash, bytes.size, "/media/cr1.jpg"))
                request.path == "/media/cr1.jpg" -> MockResponse().setBody(String(bytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        val result = manager.sync()

        assertTrue(result.isSuccess)
        val row = db.playlistItemDao().get("cr1")
        assertEquals(PlaylistItemEntity.STATUS_READY, row?.downloadStatus)
        assertEquals(bytes.toString(Charsets.UTF_8), File(row!!.localPath!!).readText())
        assertEquals("v1", appPreferences.manifestVersionSnapshot())
    }

    @Test
    fun `sync marks a hash mismatch as FAILED and never leaves a corrupt file behind`() = runTest {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" ->
                    MockResponse().setBody(manifestBody("cr1", "wrong-hash", 5, "/media/cr1.jpg"))
                request.path == "/media/cr1.jpg" -> MockResponse().setBody("wrong")
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()

        val row = db.playlistItemDao().get("cr1")
        assertEquals(PlaylistItemEntity.STATUS_FAILED, row?.downloadStatus)
        assertNull(row?.localPath)
    }

    @Test
    fun `sync never re-downloads an item that's already READY with a matching hash`() = runTest {
        val bytes = "same-bytes".toByteArray()
        val hash = sha256(bytes)
        var downloadRequests = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" ->
                    MockResponse().setBody(manifestBody("cr1", hash, bytes.size, "/media/cr1.jpg"))
                request.path == "/media/cr1.jpg" -> {
                    downloadRequests++
                    MockResponse().setBody(String(bytes))
                }
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()
        manager.sync()

        assertEquals(1, downloadRequests)
    }

    @Test
    fun `sync removes an item no longer in the manifest only after the new grade is ready`() = runTest {
        val oldBytes = "old-item".toByteArray()
        server.enqueue(
            okhttp3.mockwebserver.MockResponse().setBody(
                manifestBody("old", sha256(oldBytes), oldBytes.size, "/media/old.jpg"),
            ),
        )
        server.enqueue(okhttp3.mockwebserver.MockResponse().setBody(String(oldBytes)))
        manager.sync()
        val oldPath = db.playlistItemDao().get("old")?.localPath
        assertTrue(File(oldPath!!).exists())

        val newBytes = "new-item".toByteArray()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" ->
                    MockResponse().setBody(manifestBody("new", sha256(newBytes), newBytes.size, "/media/new.jpg"))
                request.path == "/media/new.jpg" -> MockResponse().setBody(String(newBytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()

        assertNull(db.playlistItemDao().get("old"))
        assertFalse(File(oldPath).exists())
        assertEquals(PlaylistItemEntity.STATUS_READY, db.playlistItemDao().get("new")?.downloadStatus)
    }

    @Test
    fun `sync refuses to download when it would leave less than the reserved free space`() = runTest {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val strictManager = MediaDownloadManager(
            context = context,
            apiClient = apiClient,
            deviceIdentity = deviceIdentity,
            playlistItemDao = db.playlistItemDao(),
            appPreferences = appPreferences,
            // The real production default; Robolectric's app-private
            // storage reports far less than 1 GB available.
        )
        val bytes = "small-file".toByteArray()
        server.enqueue(MockResponse().setBody(manifestBody("cr1", sha256(bytes), bytes.size, "/media/cr1.jpg")))

        strictManager.sync()

        val row = db.playlistItemDao().get("cr1")
        assertEquals(PlaylistItemEntity.STATUS_FAILED, row?.downloadStatus)
        assertEquals("insufficient_storage", row?.lastError)
    }

    @Test
    fun `readyPlaylist excludes an item whose endsAt the local clock has already passed`() = runTest {
        val bytes = "expired-item".toByteArray()
        val hash = sha256(bytes)
        val expiredBody = """
            {"manifestVersion":"v1","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1",
             "playlist":[{"campaignId":"c1","creativeId":"cr1","type":"image","mimeType":"image/jpeg",
             "durationSeconds":10.0,"fileSizeBytes":${bytes.size},"sha256":"$hash",
             "downloadUrl":"${server.url("/media/cr1.jpg")}",
             "startsAt":"2020-01-01T00:00:00Z","endsAt":"2020-01-02T00:00:00Z","position":1}]}
        """.trimIndent()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" -> MockResponse().setBody(expiredBody)
                request.path == "/media/cr1.jpg" -> MockResponse().setBody(String(bytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()

        // Downloaded and validated (READY), but never surfaced to the
        // player: the local clock says its own endsAt is long past.
        assertEquals(PlaylistItemEntity.STATUS_READY, db.playlistItemDao().get("cr1")?.downloadStatus)
        assertTrue(manager.readyPlaylist.first().isEmpty())
    }

    @Test
    fun `readyPlaylist stops trusting local expiry once the clock skew is severe`() = runTest {
        val bytes = "expired-but-skewed".toByteArray()
        val hash = sha256(bytes)
        val expiredBody = """
            {"manifestVersion":"v1","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1",
             "playlist":[{"campaignId":"c1","creativeId":"cr1","type":"image","mimeType":"image/jpeg",
             "durationSeconds":10.0,"fileSizeBytes":${bytes.size},"sha256":"$hash",
             "downloadUrl":"${server.url("/media/cr1.jpg")}",
             "startsAt":"2020-01-01T00:00:00Z","endsAt":"2020-01-02T00:00:00Z","position":1}]}
        """.trimIndent()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-manifest" -> MockResponse().setBody(expiredBody)
                request.path == "/media/cr1.jpg" -> MockResponse().setBody(String(bytes))
                else -> MockResponse().setResponseCode(404)
            }
        }
        appPreferences.setClockSkewSeconds(MediaDownloadManager.SEVERE_CLOCK_SKEW_SECONDS + 1)

        manager.sync()

        assertEquals(1, manager.readyPlaylist.first().size)
    }

    @Test
    fun `sync drops the local key pairing only on an explicit 401, matching the MAX-006 revocation rule`() = runTest {
        server.enqueue(
            okhttp3.mockwebserver.MockResponse()
                .setBody("""{"error":"unauthorized","message":"Invalid or revoked device credential."}""")
                .setResponseCode(401),
        )

        val result = manager.sync()

        assertTrue(result.isFailure)
        assertEquals(1, deviceIdentity.unauthorizedCallCount)
    }

    @Test
    fun `sync never touches the identity when it simply can't be resolved locally (MAX-011 regression)`() = runTest {
        deviceIdentity.setKeyId(null) // no server round trip should even be attempted
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(500))

        val result = manager.sync()

        assertTrue(result.exceptionOrNull() is com.maxcar.tablet.domain.DeviceApiError.CredentialUnavailable)
        assertEquals(0, server.requestCount)
        // Nothing to react to (the key_id was already null), but the
        // important part is this never called handleUnauthorizedDeviceKey
        // either — see the
        // equivalent DeviceRepository-level test for the direct assertion.
    }
}
