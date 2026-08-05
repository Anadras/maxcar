package com.maxcar.tablet.domain

/**
 * Every failure mode the device API surface can produce, mapped from the
 * Edge Functions' `{ error, message }` body / HTTP status. UI and worker
 * code branch on this instead of on raw HTTP codes or exception types.
 */
sealed class DeviceApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class NetworkUnavailable(cause: Throwable) :
        DeviceApiError("No network connection or the server could not be reached.", cause)

    /** 401 **from the server**: it explicitly rejected our credential. The
     * device must be re-enrolled; this is the only condition that may ever
     * clear local enrollment state — never treated as "try again later". */
    data class Unauthorized(val serverMessage: String) : DeviceApiError(serverMessage)

    /** No local credential could be read to even attempt the call — the
     * server was never contacted, so this is never proof of revocation.
     * Covers two very different situations that must not be conflated:
     * "never enrolled yet" (expected, harmless) and "enrolled, but
     * EncryptedSharedPreferences/Keystore is temporarily or permanently
     * unreadable" (a local storage fault that needs surfacing to the
     * operator, never a silent auto-clear of enrollment). Retried next
     * cycle rather than treated as a hard failure. */
    data class CredentialUnavailable(val reason: String) : DeviceApiError(reason)

    data class EnrollmentInvalid(val serverMessage: String) : DeviceApiError(serverMessage)

    // --- Enrollment-code rejection reasons (device-enroll-key-start),
    // each distinct so the UI never collapses them into one generic
    // "código inválido" — see supabase/migrations/20260813090000_enrollment_code_error_detail.sql
    // for why that ambiguity made a real field failure (a code expiring
    // during a slow activation) indistinguishable from an actual bug. ---

    data class EnrollmentCodeNotFound(val serverMessage: String) : DeviceApiError(serverMessage)
    data class EnrollmentCodeExpired(val serverMessage: String) : DeviceApiError(serverMessage)
    data class EnrollmentCodeAlreadyUsed(val serverMessage: String) : DeviceApiError(serverMessage)
    data class EnrollmentCodeRevoked(val serverMessage: String) : DeviceApiError(serverMessage)

    /** The enrollment attempt's own 5-minute proof-of-possession window
     * elapsed before device-enroll-key-complete was called (distinct from
     * the 15-minute enrollment *code* window above). */
    data class EnrollmentAttemptExpired(val serverMessage: String) : DeviceApiError(serverMessage)

    /** device-enroll-key-complete's signature over the server-issued
     * challenge didn't verify — never confused with an invalid code,
     * since by this point the code was already accepted. */
    data class InvalidSignature(val serverMessage: String) : DeviceApiError(serverMessage)

    data class RateLimited(val serverMessage: String) : DeviceApiError(serverMessage)

    data class ServerError(val serverMessage: String) : DeviceApiError(serverMessage)

    data class Unexpected(val serverMessage: String) : DeviceApiError(serverMessage)
}
