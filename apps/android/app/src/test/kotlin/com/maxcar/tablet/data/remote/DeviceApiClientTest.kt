package com.maxcar.tablet.data.remote

import com.maxcar.tablet.data.local.FakeDeviceKeyStore
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class DeviceApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var deviceKeyStore: FakeDeviceKeyStore
    private lateinit var client: DeviceApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() }
        client = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = deviceKeyStore)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `enrollKeyStart succeeds and parses the response`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"enrollmentAttemptId":"a1","challenge":"Y2hhbGxlbmdl","expiresAt":"2026-01-01T00:05:00Z"}""",
            ).setResponseCode(200),
        )

        val response = client.enrollKeyStart(
            EnrollKeyStartRequest(
                code = "GOODCODE",
                installationId = "i1",
                publicKey = "cHVia2V5",
                publicKeyFingerprint = "fp1",
                algorithm = "ECDSA_P256_SHA256",
            ),
        )

        assertEquals("a1", response.enrollmentAttemptId)
        assertEquals("Y2hhbGxlbmdl", response.challenge)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/device-enroll-key-start", recorded.path)
        assertTrue(recorded.body.readUtf8().contains("GOODCODE"))
        // Enrollment start carries no session yet — never signed.
        assertEquals(null, recorded.getHeader("X-Maxcar-Signature"))
    }

    @Test
    fun `enrollKeyStart maps a 401 body to Unauthorized with the server message`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"unauthorized","message":"Enrollment code is invalid, expired or already used."}""",
            ).setResponseCode(401),
        )

        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "BADCODE", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.Unauthorized")
        } catch (e: DeviceApiError.Unauthorized) {
            assertEquals("Enrollment code is invalid, expired or already used.", e.serverMessage)
        }
    }

    @Test
    fun `enrollKeyComplete signs the challenge and returns the activated key id`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1","vehicleId":null,"vehicleCode":null}""",
            ).setResponseCode(200),
        )

        val response = client.enrollKeyComplete(
            EnrollKeyCompleteRequest(enrollmentAttemptId = "a1", signature = "c2ln"),
        )

        assertEquals("k1", response.keyId)
        assertEquals("TB-001", response.deviceCode)

        val recorded = server.takeRequest()
        assertEquals("/device-enroll-key-complete", recorded.path)
    }

    @Test
    fun `heartbeat signs the request and never sends a bearer token`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
            ).setResponseCode(200),
        )

        client.heartbeat(
            keyId = "k1",
            request = HeartbeatRequest(
                batteryLevel = 80,
                networkType = "wifi",
                storageFreeBytes = 1000,
                appVersion = "0.1.0",
                deviceTime = "2026-01-01T00:00:00Z",
                clientEventId = "e1",
            ),
        )

        val recorded = server.takeRequest()
        assertEquals(null, recorded.getHeader("Authorization"))
        assertEquals("k1", recorded.getHeader("X-Maxcar-Key-Id"))
        assertEquals("MAXCAR1", recorded.getHeader("X-Maxcar-Signature-Version"))
        assertTrue(recorded.getHeader("X-Maxcar-Signature")?.isNotBlank() == true)
        assertTrue(recorded.getHeader("X-Maxcar-Nonce")?.isNotBlank() == true)
        assertFalse(recorded.body.readUtf8().contains("k1"))
    }

    @Test
    fun `the signed body hash matches the exact bytes sent`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
            ).setResponseCode(200),
        )

        client.heartbeat(
            keyId = "k1",
            request = HeartbeatRequest(
                batteryLevel = 80, networkType = "wifi", storageFreeBytes = 1000,
                appVersion = "0.1.0", deviceTime = "2026-01-01T00:00:00Z", clientEventId = "e1",
            ),
        )

        val recorded = server.takeRequest()
        val bodyBytes = recorded.body.snapshot().toByteArray()
        assertEquals(DeviceRequestSigner.sha256Hex(bodyBytes), recorded.getHeader("X-Maxcar-Body-SHA256"))
    }

    @Test
    fun `getConfig signs a GET with the empty-body hash`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","heartbeatIntervalSeconds":900,
                   |"syncIntervalSeconds":3600,"kioskEnabled":false,"loggingLevel":"info","configVersion":2}
                """.trimMargin(),
            ).setResponseCode(200),
        )

        val config = client.getConfig(keyId = "k1")

        assertEquals(900, config.heartbeatIntervalSeconds)
        assertEquals(2, config.configVersion)
        val recorded = server.takeRequest()
        assertEquals(DeviceRequestSigner.sha256Hex(ByteArray(0)), recorded.getHeader("X-Maxcar-Body-SHA256"))
    }

    @Test
    fun `a network failure surfaces as NetworkUnavailable, not a raw IOException`() = runTest {
        server.shutdown()
        try {
            client.getConfig(keyId = "k1")
            fail("expected DeviceApiError.NetworkUnavailable")
        } catch (e: DeviceApiError.NetworkUnavailable) {
            // expected
        }
    }

    @Test
    fun `a malformed success body surfaces as Unexpected, not a raw SerializationException`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"thisIsNot":"a valid response"}""").setResponseCode(200),
        )

        try {
            client.getConfig(keyId = "k1")
            fail("expected DeviceApiError.Unexpected")
        } catch (e: DeviceApiError.Unexpected) {
            // expected: a parsing failure must never crash the caller with
            // a raw kotlinx.serialization.SerializationException.
        }
    }

    @Test
    fun `getManifest parses the playlist and signs the request`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"manifestVersion":"v1","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1",
                   |"playlist":[{"campaignId":"c1","creativeId":"cr1","type":"video","mimeType":"video/mp4",
                   |"durationSeconds":15.0,"fileSizeBytes":2000,"sha256":"abc","downloadUrl":"https://x/signed",
                   |"startsAt":null,"endsAt":null,"position":1}]}
                """.trimMargin(),
            ).setResponseCode(200),
        )

        val manifest = client.getManifest(keyId = "k1")

        assertEquals("v1", manifest.manifestVersion)
        assertEquals(1, manifest.playlist.size)
        assertEquals("cr1", manifest.playlist.first().creativeId)

        val recorded = server.takeRequest()
        assertEquals("k1", recorded.getHeader("X-Maxcar-Key-Id"))
        assertEquals("/device-manifest", recorded.path)
    }

    @Test
    fun `getManifest with no playlist parses an empty list, not a crash`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"manifestVersion":"0","generatedAt":"2026-01-01T00:00:00Z","deviceId":"d1","playlist":[]}""",
            ).setResponseCode(200),
        )

        val manifest = client.getManifest(keyId = "k1")

        assertTrue(manifest.playlist.isEmpty())
    }

    @Test
    fun `sendPlaybackEvents posts the batch and parses per-event results`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"results":[{"clientEventId":"e1","ok":true,"recorded":true},
                   |{"clientEventId":"e2","ok":false,"recorded":false}]}
                """.trimMargin(),
            ).setResponseCode(200),
        )

        val response = client.sendPlaybackEvents(
            keyId = "k1",
            events = listOf(
                PlaybackEventRequest(
                    clientEventId = "e1",
                    campaignId = "c1",
                    creativeId = "cr1",
                    status = "completed",
                    startedAt = "2026-01-01T00:00:00Z",
                ),
            ),
        )

        assertEquals(2, response.results.size)
        assertTrue(response.results.first { it.clientEventId == "e1" }.ok)
        assertFalse(response.results.first { it.clientEventId == "e2" }.ok)

        val recorded = server.takeRequest()
        assertEquals("/device-playback-events", recorded.path)
        assertTrue(recorded.body.readUtf8().contains("\"clientEventId\":\"e1\""))
    }

    @Test
    fun `downloadTo streams the response body to the destination file`() = runTest {
        server.enqueue(MockResponse().setBody("fake-media-bytes"))
        val destination = kotlin.io.path.createTempFile().toFile()

        client.downloadTo(server.url("/media/file.mp4").toString(), destination)

        assertEquals("fake-media-bytes", destination.readText())
        destination.delete()
    }
}
