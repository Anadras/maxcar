package com.maxcar.tablet.data.remote

import com.maxcar.tablet.data.local.DeviceKeyStore
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID

/** The six `X-Maxcar-*` headers a MAX-010.6 signed device request carries
 * instead of a static bearer token. */
data class SignedDeviceHeaders(
    val keyId: String,
    val timestamp: String,
    val nonce: String,
    val bodySha256: String,
    val signatureBase64: String,
) {
    fun toHeaderPairs(): List<Pair<String, String>> = listOf(
        "X-Maxcar-Key-Id" to keyId,
        "X-Maxcar-Timestamp" to timestamp,
        "X-Maxcar-Nonce" to nonce,
        "X-Maxcar-Body-SHA256" to bodySha256,
        "X-Maxcar-Signature" to signatureBase64,
        "X-Maxcar-Signature-Version" to DeviceRequestSigner.SIGNATURE_VERSION,
    )
}

/**
 * Builds the canonical request bytes and signs them with the tablet's
 * [DeviceKeyStore]-resident key — the Android half of MAX-010.6's signed
 * device authentication. Must match
 * supabase/functions/_shared/device-signature.ts byte-for-byte:
 *
 * ```
 * MAXCAR1
 * <METHOD>
 * <PATH>          function name only, e.g. "/device-heartbeat" — never the
 *                  full https://…supabase.co/functions/v1/… URL
 * <TIMESTAMP>      ISO-8601, e.g. 2026-08-04T19:00:00.000Z
 * <NONCE>
 * <BODY_SHA256>    lowercase hex, sha256 of the *raw* request body bytes
 *                  (sha256("") for an empty body)
 * ```
 *
 * newline-joined UTF-8 bytes, signed ECDSA P-256/SHA-256 in the IEEE P1363
 * raw r||s format (`SHA256withECDSAinP1363Format`) so neither side needs to
 * parse ASN.1 DER. See docs/architecture/DEVICE_KEY_AUTH.md.
 */
object DeviceRequestSigner {
    const val SIGNATURE_VERSION = "MAXCAR1"

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun canonicalRequest(
        method: String,
        path: String,
        timestamp: String,
        nonce: String,
        bodySha256Hex: String,
    ): ByteArray = listOf(SIGNATURE_VERSION, method, path, timestamp, nonce, bodySha256Hex)
        .joinToString("\n")
        .toByteArray(Charsets.UTF_8)

    fun sign(
        deviceKeyStore: DeviceKeyStore,
        keyId: String,
        method: String,
        path: String,
        bodyBytes: ByteArray,
        timestamp: String = Instant.now().toString(),
        nonce: String = UUID.randomUUID().toString(),
    ): SignedDeviceHeaders {
        val bodySha256 = sha256Hex(bodyBytes)
        val canonical = canonicalRequest(method, path, timestamp, nonce, bodySha256)
        val signature = deviceKeyStore.sign(canonical)
        return SignedDeviceHeaders(
            keyId = keyId,
            timestamp = timestamp,
            nonce = nonce,
            bodySha256 = bodySha256,
            signatureBase64 = Base64.getEncoder().encodeToString(signature),
        )
    }
}
