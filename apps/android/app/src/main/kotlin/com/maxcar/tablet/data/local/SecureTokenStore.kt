package com.maxcar.tablet.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The device credential storage contract [DeviceRepository] depends on.
 * Real devices use [SecureTokenStore] (Android Keystore-backed); tests use
 * a plain in-memory fake instead, since Robolectric doesn't implement a
 * usable AndroidKeyStore. */
interface TokenStore {
    fun readToken(): String?
    fun saveToken(token: String)
    fun clear()
}

/**
 * Holds the device's own bearer credential.
 *
 * The raw token never touches Room, DataStore, or a log line: it lives only
 * in [EncryptedSharedPreferences], whose key is generated and kept inside
 * the Android Keystore (AES256-GCM), not in the app's own storage. Losing
 * this value only means the device must be re-enrolled with a new code; it
 * is never recoverable, by design, matching the server side (which only
 * ever stores a hash of it).
 */
class SecureTokenStore(context: Context) : TokenStore {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "maxcar_device_credential",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    // A decrypt failure (a Keystore key invalidated by the OS, a corrupted
    // prefs file) throws rather than returning null — never let that crash
    // a caller or, worse, be silently indistinguishable from "no token was
    // ever saved". Logged and surfaced as null either way: the caller
    // layer (DeviceRepository) is responsible for treating "no local
    // token" as fundamentally different from a server-confirmed 401 — see
    // DeviceApiError.CredentialUnavailable.
    override fun readToken(): String? = runCatching { prefs.getString(KEY_TOKEN, null) }
        .onFailure { android.util.Log.w(LOG_TAG, "readToken failed: ${it::class.simpleName}") }
        .getOrNull()

    // commit() (synchronous, blocking) rather than apply() (fire-and-forget
    // background write) is deliberate: enroll() persists this token and
    // then durably marks isEnrolled = true in the same call. With apply(),
    // a process death in the narrow window between the in-memory write and
    // the eventual disk flush would leave isEnrolled = true with no token
    // ever actually written to disk — every subsequent sync attempt would
    // then find isEnrolled true but no credential, which is exactly the
    // "keeps asking for a new activation code" failure this store exists
    // to prevent.
    override fun saveToken(token: String) {
        runCatching { prefs.edit().putString(KEY_TOKEN, token).commit() }
            .onFailure { android.util.Log.w(LOG_TAG, "saveToken failed: ${it::class.simpleName}") }
    }

    override fun clear() {
        runCatching { prefs.edit().remove(KEY_TOKEN).commit() }
            .onFailure { android.util.Log.w(LOG_TAG, "clear failed: ${it::class.simpleName}") }
    }

    private companion object {
        const val KEY_TOKEN = "device_token"
        const val LOG_TAG = "MaxcarTokenStore"
    }
}
