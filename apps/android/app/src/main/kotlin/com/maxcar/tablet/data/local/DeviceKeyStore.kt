package com.maxcar.tablet.data.local

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Log
import java.security.InvalidAlgorithmParameterException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.KeyStoreException
import java.security.MessageDigest
import java.security.NoSuchAlgorithmException
import java.security.NoSuchProviderException
import java.security.PrivateKey
import java.security.ProviderException
import java.security.Signature
import java.security.UnrecoverableKeyException
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

/** Every way local identity preparation ([DeviceKeyStore.getOrCreateKeyInfo]/
 * [DeviceKeyStore.sign]) can fail, distinct from [com.maxcar.tablet.domain.DeviceApiError]
 * since none of these ever involve the network — a caller (namely
 * [com.maxcar.tablet.data.repository.DeviceRepository.enroll]) must never
 * let one of these reach the server as if it were a rejected code: local
 * key preparation happens *before* any enrollment call, precisely so a
 * Keystore fault is never confused with, and never consumes an attempt
 * against, the human-typed code. */
sealed class DeviceIdentityError(val technicalCode: String, cause: Throwable? = null) :
    Exception(technicalCode, cause) {
    class KeystoreUnavailable(cause: Throwable) : DeviceIdentityError("KEYSTORE_UNAVAILABLE", cause)
    class KeyGenerationUnsupported(cause: Throwable) : DeviceIdentityError("KEY_GENERATION_UNSUPPORTED", cause)
    class KeyGenerationFailed(cause: Throwable) : DeviceIdentityError("KEY_GENERATION_FAILED", cause)
    class ExistingKeyUnusable(cause: Throwable) : DeviceIdentityError("EXISTING_KEY_UNUSABLE", cause)
    class PublicKeyUnavailable(cause: Throwable?) : DeviceIdentityError("PUBLIC_KEY_UNAVAILABLE", cause)
    class LocalSignatureFailed(cause: Throwable) : DeviceIdentityError("LOCAL_SIGNATURE_FAILED", cause)
}

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
     * back the same public key. Throws a specific [DeviceIdentityError],
     * never a raw platform exception. */
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
 * gated key), no StrongBox requirement (optional at the OS/hardware level
 * by default, never requested here — the pilot fleet must not depend on
 * hardware this app never explicitly asked to have). Signs with the
 * standard `SHA256withECDSA` (DER-encoded) and converts to the server's
 * expected raw r‖s format via [EcdsaSignatureFormat] — see that object's
 * doc for why signing directly in that raw format, which this project
 * originally assumed Android supported natively, isn't actually possible
 * on real hardware.
 *
 * All Keystore access is serialized through [lock]: two overlapping calls
 * to [getOrCreateKeyInfo] (e.g. a double-tap on the activation button
 * landing as two coroutines before the first can disable it) must never
 * both observe [hasKey] as false and both call [generateKey] for the same
 * alias — a real, physically-observed class of Keystore/provider fault on
 * this project's pilot hardware (see docs/architecture/ANDROID_ENROLLMENT.md's
 * MAX-011 history). [com.maxcar.tablet.data.repository.DeviceRepository.enroll]
 * additionally serializes at its own level with a [kotlinx.coroutines.sync.Mutex],
 * so this lock is defense in depth, not the only guard.
 */
class AndroidDeviceKeyStore : DeviceKeyStore {
    private val lock = Any()

    private val keyStore: KeyStore by lazy {
        runCatching { KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) } }
            .getOrElse { throw DeviceIdentityError.KeystoreUnavailable(it) }
    }

    override fun hasKey(): Boolean = synchronized(lock) {
        runCatching { keyStore.containsAlias(KEY_ALIAS) }
            .getOrElse { throw DeviceIdentityError.KeystoreUnavailable(it) }
    }

    override fun getOrCreateKeyInfo(): DeviceKeyInfo = synchronized(lock) {
        try {
            logCheckpoint("DEVICE_IDENTITY_PREPARE_START")
            val aliasPresent = runCatching { keyStore.containsAlias(KEY_ALIAS) }
                .getOrElse { throw DeviceIdentityError.KeystoreUnavailable(it) }
            logCheckpoint("KEYSTORE_PROVIDER_AVAILABLE")
            logCheckpoint(if (aliasPresent) "KEY_ALIAS_PRESENT" else "KEY_ALIAS_ABSENT")

            if (!aliasPresent) {
                logCheckpoint("KEY_GENERATION_START")
                generateKey()
                logCheckpoint("KEY_GENERATION_SUCCESS")
            }

            val info = readKeyInfoLocked(afterGeneration = !aliasPresent)
            logCheckpoint("PUBLIC_KEY_AVAILABLE")
            logCheckpoint("FINGERPRINT_SUCCESS")
            logCheckpoint("DEVICE_IDENTITY_PREPARE_COMPLETE")
            info
        } catch (e: DeviceIdentityError) {
            logIdentityFailure(e)
            throw e
        }
    }

    override fun currentKeyInfo(): DeviceKeyInfo? = synchronized(lock) {
        runCatching { readKeyInfoLocked(afterGeneration = false) }.getOrNull()
    }

    override fun sign(data: ByteArray): ByteArray = synchronized(lock) {
        try {
            val entry = runCatching {
                keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            }.getOrElse { throw DeviceIdentityError.ExistingKeyUnusable(it) }
                ?: throw DeviceIdentityError.ExistingKeyUnusable(
                    IllegalStateException("No device key present to sign with."),
                )
            try {
                // Signs in the standard DER format every provider actually
                // implements, then converts to the raw r‖s format the
                // server expects — see EcdsaSignatureFormat's doc for why
                // this project can't just ask the platform for that format
                // directly (SHA256withECDSAinP1363Format doesn't exist on
                // real Android, only on the desktop JVM this app's tests
                // happen to run on).
                val signature = Signature.getInstance(EcdsaSignatureFormat.JCA_ALGORITHM)
                signature.initSign(entry.privateKey)
                signature.update(data)
                val der = signature.sign()
                val result = EcdsaSignatureFormat.derToRaw(der)
                logCheckpoint("LOCAL_SIGN_SUCCESS")
                result
            } catch (e: KeyPermanentlyInvalidatedException) {
                throw DeviceIdentityError.ExistingKeyUnusable(e)
            } catch (e: Exception) {
                throw DeviceIdentityError.LocalSignatureFailed(e)
            }
        } catch (e: DeviceIdentityError) {
            logIdentityFailure(e)
            throw e
        }
    }

    override fun deleteKey() {
        synchronized(lock) {
            runCatching {
                if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
            }
        }
    }

    /** Must be called with [lock] already held. */
    private fun readKeyInfoLocked(afterGeneration: Boolean): DeviceKeyInfo {
        val entry = try {
            keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        } catch (e: UnrecoverableKeyException) {
            throw DeviceIdentityError.ExistingKeyUnusable(e)
        } catch (e: Exception) {
            throw DeviceIdentityError.ExistingKeyUnusable(e)
        } ?: run {
            if (afterGeneration) {
                throw DeviceIdentityError.PublicKeyUnavailable(
                    IllegalStateException("Device key generation reported success but the key is unreadable."),
                )
            }
            throw DeviceIdentityError.PublicKeyUnavailable(null)
        }
        val publicKeyDer = entry.certificate?.publicKey?.encoded
            ?: throw DeviceIdentityError.PublicKeyUnavailable(
                IllegalStateException("Key entry has no certificate/public key."),
            )
        return DeviceKeyInfo(
            publicKeyDerBase64 = Base64.getEncoder().encodeToString(publicKeyDer),
            fingerprintHex = sha256Hex(publicKeyDer),
            hardwareBacked = isHardwareBacked(entry.privateKey),
        )
    }

    /** Must be called with [lock] already held. */
    private fun generateKey() {
        val generator = try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        } catch (e: NoSuchAlgorithmException) {
            throw DeviceIdentityError.KeyGenerationUnsupported(e)
        } catch (e: NoSuchProviderException) {
            throw DeviceIdentityError.KeystoreUnavailable(e)
        }
        try {
            generator.initialize(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec(CURVE_NAME))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    // Deliberately absent: setUserAuthenticationRequired(true)
                    // and setIsStrongBoxBacked(true). This key signs
                    // unattended, in the background, on hardware this pilot
                    // doesn't require StrongBox from — requiring either
                    // would fail key generation outright on devices/OS
                    // states that don't support them, for no benefit this
                    // app actually needs.
                    .build(),
            )
        } catch (e: InvalidAlgorithmParameterException) {
            throw DeviceIdentityError.KeyGenerationUnsupported(e)
        }
        try {
            generator.generateKeyPair()
        } catch (e: ProviderException) {
            // The real-world failure mode this class exists to name
            // precisely instead of swallowing generically: a StrongBox or
            // secure-element fault, a provider-level rejection of the
            // requested parameters, or (observed on this project's pilot
            // MediaTek hardware in the token-based predecessor of this
            // class) an underlying keystore daemon fault.
            throw DeviceIdentityError.KeyGenerationFailed(e)
        } catch (e: Exception) {
            throw DeviceIdentityError.KeyGenerationFailed(e)
        }
    }

    private fun isHardwareBacked(privateKey: PrivateKey): Boolean = runCatching {
        val factory = KeyFactory.getInstance(privateKey.algorithm, ANDROID_KEYSTORE)
        val keyInfo = factory.getKeySpec(privateKey, KeyInfo::class.java)
        keyInfo.isInsideSecureHardware
    }.getOrDefault(false)

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** Logs only the checkpoint name — never a key, a signature, or any
     * value derived from either. Includes device metadata solely to make a
     * real field failure diagnosable (which manufacturer/model/OS/algorithm
     * combination it happened on), matching the same redaction discipline
     * [com.maxcar.tablet.data.repository.DeviceRepository.logFailure]
     * already follows for every other sensitive operation in this app. */
    private fun logCheckpoint(checkpoint: String) {
        Log.d(LOG_TAG, checkpoint)
    }

    /** Everything useful for diagnosing a real field failure without ever
     * touching key material: which technical code it mapped to, the raw
     * exception's own class name (never its message, which on some
     * providers can embed provider-internal detail), and the device/OS
     * combination it happened on — manufacturer and model matter here
     * specifically because this project's predecessor storage layer had a
     * real, hardware-specific fault (see
     * docs/architecture/ANDROID_ENROLLMENT.md's MAX-011 history). */
    private fun logIdentityFailure(error: DeviceIdentityError) {
        Log.w(
            LOG_TAG,
            "identity preparation failed: ${error.technicalCode} " +
                "cause=${error.cause?.let { it::class.simpleName }} " +
                "manufacturer=${Build.MANUFACTURER} model=${Build.MODEL} " +
                "sdk=${Build.VERSION.SDK_INT} provider=$ANDROID_KEYSTORE " +
                "algorithm=${EcdsaSignatureFormat.JCA_ALGORITHM} curve=$CURVE_NAME",
        )
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "maxcar_device_identity_key"
        const val CURVE_NAME = "secp256r1"
        const val LOG_TAG = "MaxcarDeviceKeyStore"
    }
}
