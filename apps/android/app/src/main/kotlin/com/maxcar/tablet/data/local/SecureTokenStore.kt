package com.maxcar.tablet.data.local

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The device credential storage contract [DeviceRepository] depends on.
 * Real devices use [SecureTokenStore] (Android Keystore-backed); tests use
 * a plain in-memory fake instead, since Robolectric doesn't implement a
 * usable AndroidKeyStore. */
interface TokenStore {
    suspend fun readToken(): String?

    /** Returns whether the token is actually durable — verified with a
     * fresh read straight from storage, not an in-memory cache, since a
     * same-process cache can make a real write failure look identical to
     * success (see [SecureTokenStore]'s class doc for the real device this
     * happened on). */
    suspend fun saveToken(token: String): Boolean
    suspend fun clear()
}

/**
 * Holds the device's own bearer credential: AES-256-GCM encrypted with a
 * key generated and kept inside the Android Keystore (never exported, never
 * in app storage), with the ciphertext persisted through Room
 * (`device_credential`) — never Room's own encryption, since Room has none;
 * this class does the encryption itself with a raw [Cipher] and stores only
 * the result.
 *
 * This replaces an earlier EncryptedSharedPreferences-based implementation
 * after a real pilot device (a Black Shark tablet) demonstrated a serious,
 * device-specific reliability problem with it: `commit()` reported success
 * immediately after saving the token — even a read-back in the same call
 * confirmed it — yet minutes later, with the *same app process still
 * running* (ruling out a cold-start/cache explanation), the token entry had
 * silently vanished from the on-disk XML file with no exception ever
 * thrown. Room's SQLite-backed reads/writes showed none of that flakiness
 * anywhere else in this app (device_state, remote_config, pending_event all
 * stayed consistent through the same session), so only the storage
 * location changes here — the encryption is still Keystore-backed AES-256,
 * just applied directly instead of through the Jetpack Security/Tink layer.
 *
 * Losing this value only means the device must be re-enrolled with a new
 * code; it is never recoverable, by design, matching the server side
 * (which only ever stores a hash of it).
 */
class SecureTokenStore(
    context: Context,
    private val dao: DeviceCredentialDao,
) : TokenStore {
    private val appContext = context.applicationContext

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    // Without this, every failed read (i.e. every cycle, forever, once the
    // row is ever missing) re-opened the legacy EncryptedSharedPreferences
    // store from scratch — a full Tink keyset init against the Keystore —
    // every 30 seconds indefinitely. Migration only ever needs to succeed
    // once; re-attempting it on every single cycle turns a one-time
    // fallback into continuous, unbounded Keystore churn instead.
    @Volatile
    private var legacyMigrationAttempted = false

    override suspend fun readToken(): String? = runCatching {
        val row = dao.get()
            ?: return@runCatching if (legacyMigrationAttempted) {
                null
            } else {
                migrateLegacyTokenIfPresent()
            }
        decrypt(row.encryptedToken)
    }.onFailure { android.util.Log.w(LOG_TAG, "readToken failed: ${it::class.simpleName}") }
        .getOrNull()

    override suspend fun saveToken(token: String): Boolean = runCatching {
        dao.upsert(DeviceCredentialEntity(encryptedToken = encrypt(token)))
        // A fresh SELECT, not a cached value — Room executes a real query
        // against SQLite every call, unlike SharedPreferencesImpl's
        // in-memory-backed reads, which is exactly what let the previous
        // implementation's failure go undetected.
        decrypt(dao.get()?.encryptedToken ?: return@runCatching false) == token
    }.onFailure { android.util.Log.w(LOG_TAG, "saveToken failed: ${it::class.simpleName}") }
        .getOrDefault(false)

    override suspend fun clear() {
        runCatching { dao.clear() }
            .onFailure { android.util.Log.w(LOG_TAG, "clear failed: ${it::class.simpleName}") }
        // Best-effort: also remove any leftover legacy file so a stale
        // pre-migration token can never resurface.
        runCatching { legacyPrefs()?.edit()?.remove(LEGACY_KEY_TOKEN)?.commit() }
    }

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return keyGenerator.generateKey()
    }

    private fun encrypt(token: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
            ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String): String? {
        val parts = payload.split(":")
        if (parts.size != 2) return null
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    /** One-time best-effort pickup of a token saved by the previous
     * EncryptedSharedPreferences-backed store, so devices already enrolled
     * before this change don't need a fresh activation code. Never a hard
     * dependency: it inherits the exact reliability problem this class
     * exists to get away from, so a failed migration just leaves the
     * device to fall back on the existing "reative este tablet" recovery
     * path rather than silently losing sync. */
    private suspend fun migrateLegacyTokenIfPresent(): String? {
        legacyMigrationAttempted = true
        val legacyToken = runCatching { legacyPrefs()?.getString(LEGACY_KEY_TOKEN, null) }
            .getOrNull() ?: return null
        if (!saveToken(legacyToken)) return null
        return legacyToken
    }

    private fun legacyPrefs() = runCatching {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            LEGACY_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrNull()

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "maxcar_device_token_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val LEGACY_PREFS_NAME = "maxcar_device_credential"
        const val LEGACY_KEY_TOKEN = "device_token"
        const val LOG_TAG = "MaxcarTokenStore"
    }
}
