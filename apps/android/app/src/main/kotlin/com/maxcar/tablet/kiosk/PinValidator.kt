package com.maxcar.tablet.kiosk

import java.security.MessageDigest

/**
 * Reproduces `set_device_maintenance_pin`'s hash on-device
 * (`sha256(pin || salt)`), so the admin PIN can be validated fully offline
 * (MAX-010 item — the car may have no signal when an operator needs
 * maintenance access). A 4-8 digit PIN is inherently brute-forceable given
 * physical access to the stored hash — the real defense is the attempt
 * lockout in [MaintenanceAccessController], not this hash's strength; see
 * docs/architecture/ANDROID_KIOSK.md.
 */
object PinValidator {
    fun matches(enteredPin: String, storedHash: String, storedSalt: String): Boolean {
        val computed = sha256Hex(enteredPin + storedSalt)
        // Constant-time comparison: even though a short PIN's hash offers
        // little resistance to offline brute force, there's no reason to
        // leak timing information to whatever is calling this.
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
