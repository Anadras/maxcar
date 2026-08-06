package com.maxcar.tablet.kiosk

import at.favre.lib.crypto.bcrypt.BCrypt
import java.security.MessageDigest

/**
 * Validates the maintenance PIN fully offline against whatever hash the
 * tablet last synced via `get_device_config` (MAX-010 — the car may have
 * no signal when an operator needs maintenance access). Two hash
 * versions, resolved by [RemoteConfigEntity.maintenancePinHashVersion][com.maxcar.tablet.data.local.RemoteConfigEntity]:
 *
 * - **v1** (legacy): `sha256(pin || salt)`. A single fast hash offers
 *   little resistance to offline brute force against a short numeric
 *   PIN — kept only so an already-configured v1 PIN keeps working until
 *   an admin rotates it (MAX-013 requires every pilot device's PIN be
 *   rotated to v2, never reusing the old value).
 * - **v2** (MAX-013): bcrypt, cost factor 12, matching
 *   `set_device_maintenance_pin`'s server-side hash exactly — bcrypt's
 *   adaptive cost is the actual documented decision here (see
 *   docs/architecture/ANDROID_KIOSK.md#pin-de-manutenção): unlike a bare
 *   SHA-256, its cost factor can be raised over time as hardware gets
 *   faster, and it's purpose-built for password/PIN hashing rather than
 *   a general-purpose digest repurposed for it.
 *
 * Both paths already run in constant time relative to a *correct* input
 * (bcrypt internally, `MessageDigest.isEqual` for v1) — the real defense
 * against a short PIN's limited hash strength is the attempt lockout in
 * [MaintenanceAccessController], not either hash's cost alone.
 */
object PinValidator {
    fun matches(enteredPin: String, storedHash: String, storedSalt: String?, hashVersion: Int): Boolean =
        when (hashVersion) {
            2 -> matchesBcrypt(enteredPin, storedHash)
            else -> matchesLegacySha256(enteredPin, storedHash, storedSalt.orEmpty())
        }

    private fun matchesBcrypt(enteredPin: String, storedHash: String): Boolean =
        runCatching {
            BCrypt.verifyer().verify(enteredPin.toCharArray(), storedHash).verified
        }.getOrDefault(false)

    private fun matchesLegacySha256(enteredPin: String, storedHash: String, storedSalt: String): Boolean {
        val computed = sha256Hex(enteredPin + storedSalt)
        return MessageDigest.isEqual(
            computed.toByteArray(Charsets.UTF_8),
            storedHash.toByteArray(Charsets.UTF_8),
        )
    }

    private fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
