package com.maxcar.tablet.data.repository

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.FakeTokenStore
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import kotlinx.coroutines.runBlocking
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

@RunWith(RobolectricTestRunner::class)
class GeoRulesSyncManagerTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var tokenStore: FakeTokenStore
    private lateinit var manager: GeoRulesSyncManager

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()

        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        tokenStore = FakeTokenStore().apply { runBlocking { saveToken("tok-1") } }

        manager = GeoRulesSyncManager(
            context = context,
            apiClient = DeviceApiClient(baseUrl = server.url("/").toString()),
            tokenStore = tokenStore,
            geoRuleDao = db.geoRuleDao(),
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

    private fun rulesBody(geofenceId: String, sha256: String, size: Int, downloadPath: String) = """
        {"rulesVersion":"v1","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1",
         "rules":[{"geofenceId":"$geofenceId","campaignId":"c1","creativeId":"cr1",
         "establishmentId":"e1","latitude":-20.4489,"longitude":-54.6167,"radiusMeters":150,
         "priority":50,"cooldownSeconds":600,"type":"image","mimeType":"image/jpeg",
         "durationSeconds":10.0,"fileSizeBytes":$size,"sha256":"$sha256",
         "downloadUrl":"${server.url(downloadPath)}","startsAt":null,"endsAt":null}]}
    """.trimIndent()

    @Test
    fun `sync downloads a new geo rule's creative, validates its hash, and marks it READY`() = runTest {
        val bytes = "geo-creative".toByteArray()
        val hash = sha256(bytes)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-geo-rules" ->
                    MockResponse().setBody(rulesBody("geo-1", hash, bytes.size, "/media/geo-1.jpg"))
                request.path == "/media/geo-1.jpg" -> MockResponse().setBody(String(bytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        val result = manager.sync()

        assertTrue(result.isSuccess)
        val row = db.geoRuleDao().get("geo-1")
        assertEquals(GeoRuleEntity.STATUS_READY, row?.downloadStatus)
        assertEquals(bytes.toString(Charsets.UTF_8), File(row!!.localPath!!).readText())
        assertEquals(50, row.priority)
        assertEquals(150, row.radiusMeters)
    }

    @Test
    fun `sync marks a hash mismatch as FAILED and never leaves a corrupt file behind`() = runTest {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-geo-rules" ->
                    MockResponse().setBody(rulesBody("geo-1", "wrong-hash", 5, "/media/geo-1.jpg"))
                request.path == "/media/geo-1.jpg" -> MockResponse().setBody("wrong")
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()

        val row = db.geoRuleDao().get("geo-1")
        assertEquals(GeoRuleEntity.STATUS_FAILED, row?.downloadStatus)
        assertNull(row?.localPath)
    }

    @Test
    fun `sync never re-downloads a rule that's already READY with a matching hash`() = runTest {
        val bytes = "same-geo-bytes".toByteArray()
        val hash = sha256(bytes)
        var downloadRequests = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-geo-rules" ->
                    MockResponse().setBody(rulesBody("geo-1", hash, bytes.size, "/media/geo-1.jpg"))
                request.path == "/media/geo-1.jpg" -> {
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
    fun `sync preserves the cooldown clock across a re-sync that doesn't change the creative`() = runTest {
        val bytes = "cooldown-bytes".toByteArray()
        val hash = sha256(bytes)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-geo-rules" ->
                    MockResponse().setBody(rulesBody("geo-1", hash, bytes.size, "/media/geo-1.jpg"))
                request.path == "/media/geo-1.jpg" -> MockResponse().setBody(String(bytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()
        db.geoRuleDao().recordTriggered("geo-1", 123456789L)

        manager.sync()

        assertEquals(123456789L, db.geoRuleDao().get("geo-1")?.lastTriggeredAtMillis)
    }

    @Test
    fun `sync removes a rule no longer delivered only after the new set is ready`() = runTest {
        val oldBytes = "old-geo".toByteArray()
        server.enqueue(MockResponse().setBody(rulesBody("old-geo", sha256(oldBytes), oldBytes.size, "/media/old.jpg")))
        server.enqueue(MockResponse().setBody(String(oldBytes)))
        manager.sync()
        val oldPath = db.geoRuleDao().get("old-geo")?.localPath
        assertTrue(File(oldPath!!).exists())

        val newBytes = "new-geo".toByteArray()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when {
                request.path == "/device-geo-rules" ->
                    MockResponse().setBody(rulesBody("new-geo", sha256(newBytes), newBytes.size, "/media/new.jpg"))
                request.path == "/media/new.jpg" -> MockResponse().setBody(String(newBytes))
                else -> MockResponse().setResponseCode(404)
            }
        }

        manager.sync()

        assertNull(db.geoRuleDao().get("old-geo"))
        assertFalse(File(oldPath).exists())
        assertEquals(GeoRuleEntity.STATUS_READY, db.geoRuleDao().get("new-geo")?.downloadStatus)
    }

    @Test
    fun `sync clears the credential only on an explicit 401`() = runTest {
        server.enqueue(
            MockResponse()
                .setBody("""{"error":"unauthorized","message":"Invalid or revoked device credential."}""")
                .setResponseCode(401),
        )

        val result = manager.sync()

        assertTrue(result.isFailure)
        assertNull(tokenStore.readToken())
    }
}
