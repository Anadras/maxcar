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

    override fun readToken(): String? = prefs.getString(KEY_TOKEN, null)

    override fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    override fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    private companion object {
        const val KEY_TOKEN = "device_token"
    }
}
