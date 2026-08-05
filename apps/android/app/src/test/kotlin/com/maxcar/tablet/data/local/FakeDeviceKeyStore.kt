package com.maxcar.tablet.data.local

import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger

/** In-memory [DeviceKeyStore] for tests: Robolectric has no usable
 * AndroidKeyStore, so [AndroidDeviceKeyStore] itself isn't testable off-
 * device — same reason [FakeTokenStore] existed for the old bearer-token
 * store. Uses a real plain-JCE EC P-256 key pair (confirmed to support
 * `SHA256withECDSAinP1363Format` on the desktop/Robolectric JVM), so
 * signatures produced here are real and verifiable, not stubbed.
 *
 * [generationCount] and [delayGenerationMillis] exist specifically to test
 * DeviceRepository.enroll()'s concurrency guard: two overlapping callers
 * must never both observe [hasKey] as false and both generate a key. */
class FakeDeviceKeyStore(
    /** Thrown by [getOrCreateKeyInfo] instead of generating/reading a key,
     * simulating a real Keystore fault — never thrown again after being
     * consumed once, so a caller's retry can succeed. */
    private var failNextGenerationWith: DeviceIdentityError? = null,
    /** Artificial delay inside key generation, to widen the race window a
     * concurrency test needs to reliably observe. */
    private val delayGenerationMillis: Long = 0,
) : DeviceKeyStore {
    private var keyPair: KeyPair? = null
    val generationCount = AtomicInteger(0)

    override fun hasKey(): Boolean = keyPair != null

    override fun getOrCreateKeyInfo(): DeviceKeyInfo {
        failNextGenerationWith?.let {
            failNextGenerationWith = null
            throw it
        }
        if (keyPair == null) {
            if (delayGenerationMillis > 0) Thread.sleep(delayGenerationMillis)
            generationCount.incrementAndGet()
            val generator = KeyPairGenerator.getInstance("EC")
            generator.initialize(ECGenParameterSpec("secp256r1"))
            keyPair = generator.generateKeyPair()
        }
        return currentKeyInfo() ?: error("Key generation reported success but the key is unreadable.")
    }

    override fun currentKeyInfo(): DeviceKeyInfo? {
        val pair = keyPair ?: return null
        val der = pair.public.encoded
        return DeviceKeyInfo(
            publicKeyDerBase64 = Base64.getEncoder().encodeToString(der),
            fingerprintHex = MessageDigest.getInstance("SHA-256").digest(der)
                .joinToString("") { "%02x".format(it) },
            hardwareBacked = false,
        )
    }

    override fun sign(data: ByteArray): ByteArray {
        val pair = keyPair ?: error("No device key present to sign with.")
        // Exactly AndroidDeviceKeyStore's real path (SHA256withECDSA + a
        // DER-to-raw conversion), deliberately never the platform-specific
        // SHA256withECDSAinP1363Format — that algorithm name only exists on
        // the desktop JVM this test runs on, not on real Android, and using
        // it here would let this exact class of bug hide behind a green
        // test suite again (which is exactly what happened before a
        // physical instrumented test caught it).
        val signature = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
        signature.initSign(pair.private)
        signature.update(data)
        return EcdsaSignatureFormat.derToRaw(signature.sign())
    }

    override fun deleteKey() {
        keyPair = null
    }
}
