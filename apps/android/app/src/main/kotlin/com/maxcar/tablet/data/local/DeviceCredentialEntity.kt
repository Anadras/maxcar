package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Holds the device's bearer token, AES-256-GCM encrypted with an
 * Android-Keystore-backed key by [SecureTokenStore] — this table never
 * sees the plaintext token, only [encryptedToken] (base64 IV + base64
 * ciphertext). Room/SQLite storage was chosen over
 * EncryptedSharedPreferences after a real pilot device demonstrated the
 * latter's file-backed commit() can report success while the write
 * silently fails to durably land; see SecureTokenStore's class doc. */
@Entity(tableName = "device_credential")
data class DeviceCredentialEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val encryptedToken: String,
) {
    companion object {
        const val SINGLETON_ID = 0
    }
}
