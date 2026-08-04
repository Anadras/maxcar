package com.maxcar.tablet.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** The tablet's own public key and its derived, non-secret fingerprint —
 * exactly what enrollment/recovery send to the server and what
 * [DeviceStateEntity.keyId] pairs with locally. Never carries the private
 * key: that half never leaves [DeviceKeyStore]. */
data class DeviceKeyInfo(
    val publicKeyDerBase64: String,
    val fingerprintHex: String,
    val hardwareBacked: Boolean,
)

/**
 * MAX-010.6: the tablet's cryptographic identity. An EC P-256 key pair is
 * generated once and never leaves this store — no method here can ever
 * return a private key, and no caller anywhere in the app should try to
 * serialize, log, or persist one. Every device-facing request is signed
 * with [sign] instead of carrying a static bearer token (see
 * [com.maxcar.tablet.data.remote.DeviceRequestSigner] and
 * docs/architecture/DEVICE_KEY_AUTH.md).
 *
 * The v1 static bearer token this replaces required a fresh human-typed
 * activation code any time its local record was lost. Losing the *local
 * record* of this key's identifiers (device_id/key_id)
 * is recoverable without a new human-typed code, because the key itself
 * can always be re-derived straight from the Keystore — see
 * [com.maxcar.tablet.data.repository.DeviceRepository]'s recovery flow.
 */
interface DeviceKeyStore {
    /** True if a key pair already exists in secure storage. */
    fun hasKey(): Boolean

    /** Returns the existing key's info, generating a new key pair first if
     * none exists yet. Never regenerates an existing key — enrollment must
     * be able to call this repeatedly (e.g. after a retry) and always get
     * back the same public key. */
    fun getOrCreateKeyInfo(): DeviceKeyInfo

    /** The existing key's info, or null if [hasKey] is false. Used to
     * re-derive the public key/fingerprint for recovery without ever
     * needing them to have been stored anywhere outside the Keystore. */
    fun currentKeyInfo(): DeviceKeyInfo?

    /** Signs [data] with the private key. Throws if no key exists yet —
     * callers must [getOrCreateKeyInfo] (or confirm [hasKey]) first. */
    fun sign(data: ByteArray): ByteArray

    /** Destroys the key pair. MAX-010.6 mandates this is never called
     * automatically by any sync/recovery path — a lost local record is
     * recovered instead of the key being discarded. Exists for the one
     * genuinely destructive, operator-initiated case (issuing a
     * replacement identity for a decommissioned/compromised tablet), not
     * for anything this app's own sync logic decides on its own. */
    fun deleteKey()
}

/** Real implementation: an Android-Keystore-resident EC P-256 key, never
 * exportable, no user-authentication requirement (the tablet signs
 * unattended, in the background, indefinitely — this is not a biometric-
 * gated key). Signs with `SHA256withECDSAinP1363Format` (API 30+; see
 * apps/android/app/build.gradle.kts's minSdk comment for why that floor is
 * safe for this fleet) so the signature is already raw 64-byte r||s with no
 * ASN.1 DER parsing needed on the server side.
 */
class AndroidDeviceKeyStore : DeviceKeyStore {
    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    override fun hasKey(): Boolean = keyStore.containsAlias(KEY_ALIAS)

    override fun getOrCreateKeyInfo(): DeviceKeyInfo {
        if (!hasKey()) generateKey()
        return currentKeyInfo()
            ?: error("Device key generation reported success but the key is unreadable.")
    }

    override fun currentKeyInfo(): DeviceKeyInfo? {
        val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry ?: return null
        val publicKeyDer = entry.certificate.publicKey.encoded
        return DeviceKeyInfo(
            publicKeyDerBase64 = Base64.getEncoder().encodeToString(publicKeyDer),
            fingerprintHex = sha256Hex(publicKeyDer),
            hardwareBacked = isHardwareBacked(entry.privateKey),
        )
    }

    override fun sign(data: ByteArray): ByteArray {
        val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            ?: error("No device key present to sign with.")
        val signature = Signature.getInstance(SIGNATURE_ALGORITHM)
        signature.initSign(entry.privateKey)
        signature.update(data)
        return signature.sign()
    }

    override fun deleteKey() {
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }

    private fun generateKey() {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        generator.initialize(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec(CURVE_NAME))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun isHardwareBacked(privateKey: PrivateKey): Boolean = runCatching {
        val factory = KeyFactory.getInstance(privateKey.algorithm, ANDROID_KEYSTORE)
        val keyInfo = factory.getKeySpec(privateKey, KeyInfo::class.java)
        keyInfo.isInsideSecureHardware
    }.getOrDefault(false)

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "maxcar_device_identity_key"
        const val CURVE_NAME = "secp256r1"
        const val SIGNATURE_ALGORITHM = "SHA256withECDSAinP1363Format"
    }
}
