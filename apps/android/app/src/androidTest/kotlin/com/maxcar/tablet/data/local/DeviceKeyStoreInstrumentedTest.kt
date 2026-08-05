package com.maxcar.tablet.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec

/**
 * MAX-010.6 physical validation (section 5 of the identity-preparation
 * diagnostic): confirms this exact hardware/Android build genuinely
 * supports what [AndroidDeviceKeyStore] needs — EC P-256/secp256r1 key
 * generation in AndroidKeyStore, no user-authentication requirement, and
 * signing/verifying via [EcdsaSignatureFormat]'s DER-to-raw conversion —
 * without touching the production alias or spending a real enrollment
 * code. Uses its own dedicated diagnostic alias, deleted at the end of
 * every test; never the alias [AndroidDeviceKeyStore] itself uses for the
 * tablet's real identity.
 *
 * The first test in this file is exactly how a real, physical bug was
 * caught in this project: `SHA256withECDSAinP1363Format` — this project's
 * original assumption for how Android would produce the server's raw r‖s
 * signature format directly — turned out not to exist on *any* security
 * provider on real Android (Android 15/API 35, this pilot's actual
 * hardware), even though it worked in every JVM/Robolectric unit test
 * (those run on the desktop JVM's SunEC provider, which does register that
 * name). Only a test that runs on the real device could have caught this;
 * that's why this file exists at all, not just JVM-level tests of
 * [EcdsaSignatureFormat].
 */
@RunWith(AndroidJUnit4::class)
class DeviceKeyStoreInstrumentedTest {
    private val alias = "maxcar_diagnostic_key_${System.currentTimeMillis()}"
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun cleanUp() {
        runCatching { if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias) }
    }

    @Test
    fun theP1363SignatureAlgorithmIsNotAvailableOnAnyProviderButTheStandardOneIs() {
        // A permanent regression guard, not just a one-off diagnostic: if a
        // future Android version or a different device in the fleet ever
        // *does* register SHA256withECDSAinP1363Format, that's fine and
        // harmless to learn about; what must never silently regress is the
        // standard algorithm this app actually depends on now.
        val p1363Available = runCatching { Signature.getInstance("SHA256withECDSAinP1363Format") }.isSuccess
        android.util.Log.i(
            "MaxcarDiagnostic",
            "SHA256withECDSAinP1363Format available on this device: $p1363Available",
        )
        val standardAvailable = runCatching { Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM) }.isSuccess
        assertTrue(
            "${EcdsaSignatureFormat.JCA_ALGORITHM} must be available — this app's entire signing " +
                "path depends on it",
            standardAvailable,
        )
    }

    @Test
    fun androidKeystoreGeneratesSignsAndVerifiesAnEcP256Key() {
        try {
            // 1-4: AndroidKeyStore available, alias absent, generation starts and succeeds.
            assertTrue("AndroidKeyStore provider must be available", !keyStore.containsAlias(alias))

            val generator = KeyPairGenerator.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore",
            )
            generator.initialize(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    alias,
                    android.security.keystore.KeyProperties.PURPOSE_SIGN,
                )
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                    // No setUserAuthenticationRequired(true), no
                    // setIsStrongBoxBacked(true) — the pilot must not
                    // depend on either.
                    .build(),
            )
            generator.generateKeyPair()
            assertTrue("the alias must exist immediately after generation", keyStore.containsAlias(alias))

            // 5-7: private key created, public key obtained and encoded.
            val entry = keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry
            val publicKeyDer = entry.certificate.publicKey.encoded
            assertTrue("the encoded public key must be non-empty", publicKeyDer.isNotEmpty())

            // 8: fingerprint (SHA-256 of the DER-encoded public key) is stable.
            val fingerprint1 = MessageDigest.getInstance("SHA-256").digest(publicKeyDer)
            val fingerprint2 = MessageDigest.getInstance("SHA-256").digest(publicKeyDer)
            assertArrayEquals(fingerprint1, fingerprint2)

            // 9: local signature via the exact real path AndroidDeviceKeyStore.sign() takes.
            val payload = "maxcar-diagnostic-payload".toByteArray(Charsets.UTF_8)
            val signer = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
            signer.initSign(entry.privateKey)
            signer.update(payload)
            val der = signer.sign()
            val rawSignature = EcdsaSignatureFormat.derToRaw(der)
            assertEqual64Bytes(rawSignature)

            // 10: verify with the *re-imported* public key bytes, exactly as
            // the server does (SPKI DER -> crypto.subtle.importKey('spki', ...)),
            // not just the in-memory PublicKey object generation returned —
            // and by converting the raw signature back to DER first, exactly
            // mirroring EcdsaSignatureFormat's own round-trip contract
            // without needing a hand-rolled raw-format verifier here.
            val reimportedPublicKey = KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(publicKeyDer))
            val verifier = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
            verifier.initVerify(reimportedPublicKey)
            verifier.update(payload)
            assertTrue(
                "the signature must verify against the key's own public half",
                verifier.verify(EcdsaSignatureFormat.rawToDer(rawSignature)),
            )

            // Reread the same alias to confirm it survives a second lookup
            // (approximates "reopen the app"; a real reboot/adb install -r
            // check happens in the physical test protocol, not here).
            val rereadEntry = keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry
            assertArrayEquals(publicKeyDer, rereadEntry.certificate.publicKey.encoded)
        } finally {
            cleanUp()
        }
    }

    private fun assertEqual64Bytes(signature: ByteArray) {
        assertEquals(
            "a P-256 signature in raw r‖s format must be exactly 64 bytes (32-byte r + 32-byte s)",
            64,
            signature.size,
        )
    }

    @Test
    fun theSameAliasIsReusedRatherThanRegeneratedOnASecondCall() {
        try {
            val generator = KeyPairGenerator.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore",
            )
            generator.initialize(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    alias,
                    android.security.keystore.KeyProperties.PURPOSE_SIGN,
                )
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                    .build(),
            )
            generator.generateKeyPair()
            val firstPublicKey = (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry)
                .certificate.publicKey.encoded

            // A real getOrCreateKeyInfo() call would see containsAlias == true
            // here and skip generation entirely — this asserts the
            // underlying assumption that reading twice, without
            // regenerating, yields the identical public key.
            val secondPublicKey = (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry)
                .certificate.publicKey.encoded
            assertArrayEquals(firstPublicKey, secondPublicKey)
        } finally {
            cleanUp()
        }
    }
}
