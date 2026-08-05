package com.maxcar.tablet.data.local

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * MAX-010.6 correction: this converter exists specifically because
 * `SHA256withECDSAinP1363Format` — this project's original assumption for
 * how Android would produce the server's required raw r‖s signature format
 * directly — does not exist on any real Android security provider
 * (confirmed via a physical instrumented test on Android 15/API 35; it
 * only ever worked in JVM/Robolectric tests because the desktop JVM's
 * SunEC provider registers that algorithm name, which Android's
 * Conscrypt/BoringSSL-backed providers never did). Every test here signs
 * with the real, standard `SHA256withECDSA` and round-trips through DER,
 * exactly the path [AndroidDeviceKeyStore.sign] and [FakeDeviceKeyStore.sign]
 * both actually take now.
 */
class EcdsaSignatureFormatTest {

    private fun generateKeyPair() = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()

    @Test
    fun `a real DER signature converts to exactly 64 raw bytes for P-256`() {
        val keyPair = generateKeyPair()
        val signer = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
        signer.initSign(keyPair.private)
        signer.update("maxcar-test-payload".toByteArray())
        val der = signer.sign()

        val raw = EcdsaSignatureFormat.derToRaw(der)

        assertEquals(64, raw.size)
    }

    @Test
    fun `the converted raw signature verifies against the standard DER verifier after converting back`() {
        // Simulates exactly what the server does in reverse-shape: Android
        // signs DER, converts to raw for transport; this asserts round-
        // tripping raw back to DER produces something a completely
        // standard java.security.Signature verifier (never anything
        // Android-Keystore-specific) accepts as valid.
        val keyPair = generateKeyPair()
        val payload = "maxcar-test-payload".toByteArray()
        val signer = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
        signer.initSign(keyPair.private)
        signer.update(payload)
        val der = signer.sign()

        val raw = EcdsaSignatureFormat.derToRaw(der)
        val reconstitutedDer = EcdsaSignatureFormat.rawToDer(raw)

        val verifier = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
        verifier.initVerify(keyPair.public)
        verifier.update(payload)
        assertTrue(verifier.verify(reconstitutedDer))
    }

    @Test
    fun `many real signatures all convert to exactly 64 bytes, including short r or s components`() {
        // DER's variable-length INTEGER encoding means r or s occasionally
        // needs padding (when naturally shorter than 32 bytes) and
        // occasionally needs its DER sign-guard byte stripped (when the
        // high bit is set) — signing enough real payloads exercises both
        // without needing to hand-construct a synthetic edge case.
        val keyPair = generateKeyPair()
        repeat(200) { i ->
            val signer = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
            signer.initSign(keyPair.private)
            signer.update("payload-$i".toByteArray())
            val der = signer.sign()

            val raw = EcdsaSignatureFormat.derToRaw(der)

            assertEquals("payload-$i produced a raw signature of the wrong size", 64, raw.size)
        }
    }

    @Test
    fun `derToRaw is deterministic for the same DER input`() {
        val keyPair = generateKeyPair()
        val signer = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
        signer.initSign(keyPair.private)
        signer.update("maxcar-test-payload".toByteArray())
        val der = signer.sign()

        val first = EcdsaSignatureFormat.derToRaw(der)
        val second = EcdsaSignatureFormat.derToRaw(der)

        assertArrayEquals(first, second)
    }

    @Test
    fun `a raw signature with a short component round-trips correctly through rawToDer`() {
        // r deliberately begins with several zero bytes (as if it were a
        // small integer) to exercise encodeInteger's leading-zero-stripping
        // and re-guarding logic directly, independent of real key material.
        val raw = ByteArray(64)
        raw[30] = 0x01
        raw[31] = 0x02
        raw[62] = 0x03
        raw[63] = 0x04

        val der = EcdsaSignatureFormat.rawToDer(raw)
        val roundTripped = EcdsaSignatureFormat.derToRaw(der)

        assertArrayEquals(raw, roundTripped)
    }

    @Test
    fun `a raw signature with a high bit set round-trips correctly through rawToDer`() {
        // r's first byte has the high bit set — DER must add a 0x00 guard
        // byte so it isn't misread as a negative INTEGER, and derToRaw must
        // strip that guard byte back out to land on exactly 32 bytes again.
        val raw = ByteArray(64) { 0xFF.toByte() }

        val der = EcdsaSignatureFormat.rawToDer(raw)
        val roundTripped = EcdsaSignatureFormat.derToRaw(der)

        assertArrayEquals(raw, roundTripped)
    }
}
