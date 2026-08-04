package com.maxcar.tablet.data.local

import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** In-memory [DeviceKeyStore] for tests: Robolectric has no usable
 * AndroidKeyStore, so [AndroidDeviceKeyStore] itself isn't testable off-
 * device — same reason [FakeTokenStore] existed for the old bearer-token
 * store. Uses a real plain-JCE EC P-256 key pair (confirmed to support
 * `SHA256withECDSAinP1363Format` on the desktop/Robolectric JVM), so
 * signatures produced here are real and verifiable, not stubbed. */
class FakeDeviceKeyStore : DeviceKeyStore {
    private var keyPair: KeyPair? = null

    override fun hasKey(): Boolean = keyPair != null

    override fun getOrCreateKeyInfo(): DeviceKeyInfo {
        if (keyPair == null) {
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
        val signature = Signature.getInstance("SHA256withECDSAinP1363Format")
        signature.initSign(pair.private)
        signature.update(data)
        return signature.sign()
    }

    override fun deleteKey() {
        keyPair = null
    }
}
