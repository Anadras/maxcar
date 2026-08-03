package com.maxcar.tablet.data.remote

import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

/**
 * Thin HTTP client for the three device endpoints. No Supabase SDK, no
 * Supabase JWT, no service role key: this app only ever knows the base URL
 * and its own bearer token (or none yet, for /device-enroll).
 */
class DeviceApiClient(
    private val baseUrl: String,
    private val json: Json = Json { ignoreUnknownKeys = true },
    okHttpClient: OkHttpClient? = null,
) {
    private val client: OkHttpClient = okHttpClient ?: OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .addInterceptor(RedactingLoggingInterceptor())
        .build()

    fun enroll(request: EnrollRequest): EnrollResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-enroll")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(EnrollResponse.serializer(), it) }
    }

    fun heartbeat(token: String, request: HeartbeatRequest): HeartbeatResponse {
        val body = json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE)
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-heartbeat")
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()
        return execute(httpRequest) { json.decodeFromString(HeartbeatResponse.serializer(), it) }
    }

    fun getConfig(token: String): ConfigResponse {
        val httpRequest = Request.Builder()
            .url(baseUrl + "device-config")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        return execute(httpRequest) { json.decodeFromString(ConfigResponse.serializer(), it) }
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
 * bearer token) or bodies (which carry the enrollment code or token). */
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
