package com.maxcar.tablet.domain

/**
 * Every failure mode the device API surface can produce, mapped from the
 * Edge Functions' `{ error, message }` body / HTTP status. UI and worker
 * code branch on this instead of on raw HTTP codes or exception types.
 */
sealed class DeviceApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class NetworkUnavailable(cause: Throwable) :
        DeviceApiError("No network connection or the server could not be reached.", cause)

    /** 401: token missing, invalid, or revoked. The device must be
     * re-enrolled; this is never treated as "try again later". */
    data class Unauthorized(val serverMessage: String) : DeviceApiError(serverMessage)

    data class EnrollmentInvalid(val serverMessage: String) : DeviceApiError(serverMessage)

    data class RateLimited(val serverMessage: String) : DeviceApiError(serverMessage)

    data class ServerError(val serverMessage: String) : DeviceApiError(serverMessage)

    data class Unexpected(val serverMessage: String) : DeviceApiError(serverMessage)
}
