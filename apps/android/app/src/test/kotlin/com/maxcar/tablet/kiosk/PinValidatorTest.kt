package com.maxcar.tablet.kiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

private fun sha256Hex(value: String) =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

class PinValidatorTest {

    @Test
    fun `matches the same reproducible hash the server computes`() {
        val pin = "246810"
        val salt = "a1b2c3"
        val hash = sha256Hex(pin + salt)

        assertTrue(PinValidator.matches(pin, hash, salt))
    }

    @Test
    fun `rejects a wrong PIN against the same salt`() {
        val salt = "a1b2c3"
        val hash = sha256Hex("246810" + salt)

        assertFalse(PinValidator.matches("000000", hash, salt))
    }

    @Test
    fun `rejects the right PIN against the wrong salt`() {
        val hash = sha256Hex("246810" + "a1b2c3")

        assertFalse(PinValidator.matches("246810", hash, "different-salt"))
    }
}
