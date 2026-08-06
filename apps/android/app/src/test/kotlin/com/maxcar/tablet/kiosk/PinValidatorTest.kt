package com.maxcar.tablet.kiosk

import at.favre.lib.crypto.bcrypt.BCrypt
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

private fun sha256Hex(value: String) =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

class PinValidatorTest {

    // --- version 2 (bcrypt, current) ---

    @Test
    fun `v2 matches the same bcrypt hash the server computes`() {
        val pin = "246810"
        val hash = BCrypt.withDefaults().hashToString(12, pin.toCharArray())

        assertTrue(PinValidator.matches(pin, hash, storedSalt = null, hashVersion = 2))
    }

    @Test
    fun `v2 rejects a wrong PIN against the same bcrypt hash`() {
        val hash = BCrypt.withDefaults().hashToString(12, "246810".toCharArray())

        assertFalse(PinValidator.matches("000000", hash, storedSalt = null, hashVersion = 2))
    }

    @Test
    fun `v2 never throws on a malformed stored hash, just fails closed`() {
        assertFalse(PinValidator.matches("246810", "not-a-real-bcrypt-hash", storedSalt = null, hashVersion = 2))
    }

    // --- version 1 (legacy sha256(pin||salt)) ---

    @Test
    fun `v1 matches the same reproducible hash the server computes`() {
        val pin = "246810"
        val salt = "a1b2c3"
        val hash = sha256Hex(pin + salt)

        assertTrue(PinValidator.matches(pin, hash, salt, hashVersion = 1))
    }

    @Test
    fun `v1 rejects a wrong PIN against the same salt`() {
        val salt = "a1b2c3"
        val hash = sha256Hex("246810" + salt)

        assertFalse(PinValidator.matches("000000", hash, salt, hashVersion = 1))
    }

    @Test
    fun `v1 rejects the right PIN against the wrong salt`() {
        val hash = sha256Hex("246810" + "a1b2c3")

        assertFalse(PinValidator.matches("246810", hash, "different-salt", hashVersion = 1))
    }
}
