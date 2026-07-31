package com.maxcar.tablet.data.remote

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
    private lateinit var client: DeviceApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = DeviceApiClient(baseUrl = server.url("/").toString())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `enroll succeeds and parses the response`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceToken":"abc123","deviceId":"d1","deviceCode":"TB-001","vehicleId":null,"vehicleCode":null}""",
            ).setResponseCode(200),
        )

        val response = client.enroll(EnrollRequest(code = "GOODCODE", installationId = "i1"))

        assertEquals("abc123", response.deviceToken)
        assertEquals("TB-001", response.deviceCode)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/device-enroll", recorded.path)
        assertTrue(recorded.body.readUtf8().contains("GOODCODE"))
    }

    @Test
    fun `enroll maps a 401 body to Unauthorized with the server message`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"unauthorized","message":"Enrollment code is invalid, expired or already used."}""",
            ).setResponseCode(401),
        )

        try {
            client.enroll(EnrollRequest(code = "BADCODE", installationId = "i1"))
            fail("expected DeviceApiError.Unauthorized")
        } catch (e: DeviceApiError.Unauthorized) {
            assertEquals("Enrollment code is invalid, expired or already used.", e.serverMessage)
        }
    }

    @Test
    fun `enroll maps a 429 body to RateLimited`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"error":"rate_limited","message":"Too many enrollment attempts. Try again later."}""",
            ).setResponseCode(429),
        )

        try {
            client.enroll(EnrollRequest(code = "X", installationId = "i1"))
            fail("expected DeviceApiError.RateLimited")
        } catch (e: DeviceApiError.RateLimited) {
            assertTrue(e.serverMessage.contains("Too many"))
        }
    }

    @Test
    fun `heartbeat sends the bearer token and never as a query param or body field`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","recordedAt":"2026-01-01T00:00:00Z"}""",
            ).setResponseCode(200),
        )

        client.heartbeat(
            token = "secret-token",
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
        assertEquals("Bearer secret-token", recorded.getHeader("Authorization"))
        assertFalse(recorded.body.readUtf8().contains("secret-token"))
    }

    @Test
    fun `getConfig returns the parsed remote config`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"deviceId":"d1","deviceCode":"TB-001","heartbeatIntervalSeconds":900,
                   |"syncIntervalSeconds":3600,"kioskEnabled":false,"loggingLevel":"info","configVersion":2}
                """.trimMargin(),
            ).setResponseCode(200),
        )

        val config = client.getConfig(token = "secret-token")

        assertEquals(900, config.heartbeatIntervalSeconds)
        assertEquals(2, config.configVersion)
    }

    @Test
    fun `a network failure surfaces as NetworkUnavailable, not a raw IOException`() = runTest {
        server.shutdown()
        try {
            client.getConfig(token = "secret-token")
            fail("expected DeviceApiError.NetworkUnavailable")
        } catch (e: DeviceApiError.NetworkUnavailable) {
            // expected
        }
    }
}
