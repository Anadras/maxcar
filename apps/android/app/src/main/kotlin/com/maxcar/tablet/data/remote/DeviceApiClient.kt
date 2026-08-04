package com.maxcar.tablet.data.remote

import com.maxcar.tablet.data.local.DeviceKeyStore
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
private val EMPTY_BODY = ByteArray(0)

/**
 * Thin HTTP client for the device endpoints. MAX-010.6: no bearer token is
 * ever sent for the data endpoints — each call is signed with the
 * tablet's own Android-Keystore-backed key via [DeviceRequestSigner].
 * Enrollment and recovery instead prove possession of that same key by
 * signing a server-issued challenge (see [enrollKeyComplete]/
 * [recoverKeyComplete]) — the start calls themselves carry no secret and
 * are never signed, since no key session exists yet at that point.
 */
class DeviceApiClient(
    private val baseUrl: String,
    private val deviceKeyStore: DeviceKeyStore? = null,
    private val json: Json = Json { ignoreUnknownKeys = true },
    okHttpClient: OkHttpClient? = null,
) {
    private val client: OkHttpClient = okHttpClient ?: OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .addInterceptor(RedactingLoggingInterceptor())
        .build()

    fun enrollKeyStart(request: EnrollKeyStartRequest): EnrollKeyStartResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-enroll-key-start")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(EnrollKeyStartResponse.serializer(), it) }
    }

    fun enrollKeyComplete(request: EnrollKeyCompleteRequest): EnrollKeyCompleteResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-enroll-key-complete")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(EnrollKeyCompleteResponse.serializer(), it) }
    }

    fun recoverKeyStart(request: RecoverKeyStartRequest): RecoverKeyStartResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-recover-key-start")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(RecoverKeyStartResponse.serializer(), it) }
    }

    fun recoverKeyComplete(request: RecoverKeyCompleteRequest): RecoverKeyCompleteResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-recover-key-complete")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(RecoverKeyCompleteResponse.serializer(), it) }
    }

    fun heartbeat(keyId: String, request: HeartbeatRequest): HeartbeatResponse =
        signedPost("device-heartbeat", keyId, json.encodeToString(request)) {
            json.decodeFromString(HeartbeatResponse.serializer(), it)
        }

    fun getConfig(keyId: String): ConfigResponse =
        signedGet("device-config", keyId) { json.decodeFromString(ConfigResponse.serializer(), it) }

    fun getManifest(keyId: String): ManifestResponse =
        signedGet("device-manifest", keyId) { json.decodeFromString(ManifestResponse.serializer(), it) }

    fun sendPlaybackEvents(keyId: String, events: List<PlaybackEventRequest>): PlaybackEventsResponse =
        signedPost("device-playback-events", keyId, json.encodeToString(PlaybackEventsRequest(events))) {
            json.decodeFromString(PlaybackEventsResponse.serializer(), it)
        }

    /** GEO geofence rules for the Location Engine (MAX-008); same shape and
     * download pipeline as [getManifest], just for GEO campaigns. */
    fun getGeoRules(keyId: String): GeoRulesResponse =
        signedGet("device-geo-rules", keyId) { json.decodeFromString(GeoRulesResponse.serializer(), it) }

    fun sendGeofenceEvents(keyId: String, events: List<GeofenceEventRequest>): GeofenceEventsResponse =
        signedPost("device-geofence-events", keyId, json.encodeToString(GeofenceEventsRequest(events))) {
            json.decodeFromString(GeofenceEventsResponse.serializer(), it)
        }

    /** MAX-009 remote commands: fetches whatever is pending for this
     * device (marks them delivered server-side). */
    fun getPendingCommands(keyId: String): DeviceCommandsResponse =
        signedGet("device-commands", keyId) { json.decodeFromString(DeviceCommandsResponse.serializer(), it) }

    fun acknowledgeCommand(
        keyId: String,
        commandId: String,
        status: String,
        result: String?,
    ): AcknowledgeCommandResponse = signedPost(
        "device-commands",
        keyId,
        json.encodeToString(AcknowledgeCommandRequest(commandId, status, result)),
    ) { json.decodeFromString(AcknowledgeCommandResponse.serializer(), it) }

    /** Streams a signed URL straight to disk without ever holding the full
     * file in memory — a video can be tens of megabytes, and this call
     * always runs off the main thread via [com.maxcar.tablet.data.repository.MediaDownloadManager]. */
    fun downloadTo(url: String, destination: java.io.File) {
        val httpRequest = Request.Builder().url(url).get().build()
        val response = try {
            client.newCall(httpRequest).execute()
        } catch (e: IOException) {
            throw DeviceApiError.NetworkUnavailable(e)
        }
        response.use {
            if (!it.isSuccessful) {
                throw DeviceApiError.ServerError("Download failed (HTTP ${it.code}).")
            }
            val body = it.body
            destination.outputStream().use { output ->
                body.byteStream().copyTo(output)
            }
        }
    }

    private fun <T> signedGet(functionName: String, keyId: String, decode: (String) -> T): T {
        val httpRequest = Request.Builder()
            .url(baseUrl + functionName)
            .headers(signedHeaders(keyId, "GET", "/$functionName", EMPTY_BODY))
            .get()
            .build()
        return execute(httpRequest, decode)
    }

    private fun <T> signedPost(
        functionName: String,
        keyId: String,
        bodyJson: String,
        decode: (String) -> T,
    ): T {
        val bodyBytes = bodyJson.toByteArray(Charsets.UTF_8)
        val httpRequest = Request.Builder()
            .url(baseUrl + functionName)
            .headers(signedHeaders(keyId, "POST", "/$functionName", bodyBytes))
            .post(bodyBytes.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        return execute(httpRequest, decode)
    }

    private fun signedHeaders(keyId: String, method: String, path: String, bodyBytes: ByteArray): Headers {
        val keyStore = deviceKeyStore
            ?: error("DeviceApiClient has no DeviceKeyStore to sign requests with.")
        val signed = DeviceRequestSigner.sign(keyStore, keyId, method, path, bodyBytes)
        val builder = Headers.Builder()
        signed.toHeaderPairs().forEach { (name, value) -> builder.add(name, value) }
        return builder.build()
    }

    private fun <T> execute(request: Request, decode: (String) -> T): T {
        val response: Response
        try {
            response = client.newCall(request).execute()
        } catch (e: IOException) {
            throw DeviceApiError.NetworkUnavailable(e)
        }
        response.use {
            val bodyText = it.body.string()
            if (it.isSuccessful) {
                return try {
                    decode(bodyText)
                } catch (e: SerializationException) {
                    throw DeviceApiError.Unexpected("The server returned an unexpected response.")
                }
            }
            val errorBody = runCatching {
                json.decodeFromString(ApiErrorBody.serializer(), bodyText)
            }.getOrNull()
            val message = errorBody?.message ?: "Unexpected error (HTTP ${it.code})."
            throw when (it.code) {
                401 -> DeviceApiError.Unauthorized(message)
                400, 404 -> DeviceApiError.EnrollmentInvalid(message)
                429 -> DeviceApiError.RateLimited(message)
                in 500..599 -> DeviceApiError.ServerError(message)
                else -> DeviceApiError.Unexpected(message)
            }
        }
    }
}

/** Logs method, path and status only — never headers (which carry the
 * signature/key id) or bodies (which carry the enrollment code). */
private class RedactingLoggingInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        android.util.Log.d(
            "MaxcarDeviceApi",
            "${request.method} ${request.url.encodedPath} -> ${response.code}",
        )
        return response
    }
}
