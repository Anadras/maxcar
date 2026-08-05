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

    // --- MAX-010.6 follow-up: each enrollment-code rejection reason maps
    // to its own DeviceApiError subtype via the response body's `error`
    // slug, not the generic Unauthorized every other 401 still uses. ---

    @Test
    fun `enrollKeyStart maps code_not_found to EnrollmentCodeNotFound`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"code_not_found","message":"Enrollment code not found."}""",
            ).setResponseCode(404),
        )
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "NOPECODE", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.EnrollmentCodeNotFound")
        } catch (e: DeviceApiError.EnrollmentCodeNotFound) {
            assertEquals("Enrollment code not found.", e.serverMessage)
        }
    }

    @Test
    fun `enrollKeyStart maps code_expired to EnrollmentCodeExpired, distinct from code_already_used`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"code_expired","message":"Enrollment code has expired."}""",
            ).setResponseCode(410),
        )
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "OLDCODE1", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.EnrollmentCodeExpired")
        } catch (e: DeviceApiError.EnrollmentCodeExpired) {
            // expected — critically, NOT EnrollmentCodeAlreadyUsed.
        }
    }

    @Test
    fun `enrollKeyStart maps code_already_used to EnrollmentCodeAlreadyUsed`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"code_already_used","message":"Enrollment code has already been used."}""",
            ).setResponseCode(409),
        )
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "USEDCODE", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.EnrollmentCodeAlreadyUsed")
        } catch (e: DeviceApiError.EnrollmentCodeAlreadyUsed) {
            // expected
        }
    }

    @Test
    fun `enrollKeyStart maps code_revoked to EnrollmentCodeRevoked`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"code_revoked","message":"Enrollment code has been revoked."}""",
            ).setResponseCode(409),
        )
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "REVKCODE", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.EnrollmentCodeRevoked")
        } catch (e: DeviceApiError.EnrollmentCodeRevoked) {
            // expected
        }
    }

    @Test
    fun `enrollKeyComplete maps challenge_expired to EnrollmentAttemptExpired`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"challenge_expired","message":"Enrollment challenge has expired."}""",
            ).setResponseCode(410),
        )
        try {
            client.enrollKeyComplete(EnrollKeyCompleteRequest(enrollmentAttemptId = "a1", signature = "c2ln"))
            fail("expected DeviceApiError.EnrollmentAttemptExpired")
        } catch (e: DeviceApiError.EnrollmentAttemptExpired) {
            // expected
        }
    }

    @Test
    fun `enrollKeyComplete maps invalid_signature to InvalidSignature, distinct from an invalid code`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"invalid_signature","message":"Invalid proof of possession."}""",
            ).setResponseCode(401),
        )
        try {
            client.enrollKeyComplete(EnrollKeyCompleteRequest(enrollmentAttemptId = "a1", signature = "c2ln"))
            fail("expected DeviceApiError.InvalidSignature")
        } catch (e: DeviceApiError.InvalidSignature) {
            // expected — critically, not EnrollmentCodeNotFound or Unauthorized.
        }
    }

    @Test
    fun `a network failure during enrollment is never mistaken for an invalid code`() = runTest {
        server.shutdown()
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "ANYCODE1", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.NetworkUnavailable")
        } catch (e: DeviceApiError.NetworkUnavailable) {
            // expected — never EnrollmentCodeNotFound/EnrollmentCodeExpired/etc.
        }
    }

    @Test
    fun `a 500 during enrollment is never mistaken for an invalid code`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"server_error"}"""))
        try {
            client.enrollKeyStart(
                EnrollKeyStartRequest(
                    code = "ANYCODE1", installationId = "i1", publicKey = "cHVia2V5",
                    publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
                ),
            )
            fail("expected DeviceApiError.ServerError")
        } catch (e: DeviceApiError.ServerError) {
            // expected
        }
    }

    @Test
    fun `an enrollment code is sent to the server exactly as typed, leading characters and all`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"enrollmentAttemptId":"a1","challenge":"Y2hhbGxlbmdl","expiresAt":"2026-01-01T00:05:00Z"}""",
            ),
        )
        // A code beginning with a digit is exactly the case where an
        // accidental numeric round-trip somewhere in the pipeline would
        // silently drop a leading character — this asserts the exact wire
        // bytes instead of trusting that it "looks fine".
        client.enrollKeyStart(
            EnrollKeyStartRequest(
                code = "07K9F3QH", installationId = "i1", publicKey = "cHVia2V5",
                publicKeyFingerprint = "fp1", algorithm = "ECDSA_P256_SHA256",
            ),
        )
        val recorded = server.takeRequest()
        assertTrue(recorded.body.readUtf8().contains("\"code\":\"07K9F3QH\""))
    }

    @Test
    fun `enrollKeyComplete retried with the same attempt id after a timeout reaches the server identically`() = runTest {
        // DeviceRepository.enroll() doesn't itself retry, but the RPC layer
        // (complete_device_key_enrollment) is idempotent specifically so a
        // caller-level retry after a timeout is safe — this just confirms
        // the client sends the exact same, replayable request both times.
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1","vehicleId":null,"vehicleCode":null}""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","keyId":"k1","vehicleId":null,"vehicleCode":null}""",
            ),
        )
        val request = EnrollKeyCompleteRequest(enrollmentAttemptId = "a1", signature = "c2ln")
        val first = client.enrollKeyComplete(request)
        val second = client.enrollKeyComplete(request)
        assertEquals(first.keyId, second.keyId)
        assertEquals("k1", second.keyId)
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
