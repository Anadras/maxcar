package com.maxcar.tablet.data.local

/** In-memory [TokenStore] for tests: Robolectric has no usable
 * AndroidKeyStore, so [SecureTokenStore] itself isn't testable off-device.
 * [simulateSilentSaveFailure] reproduces the real failure a pilot device
 * hit: saveToken() neither throws nor logs anything, it just doesn't
 * persist — a real Keystore/storage-backed store can behave this way even
 * though the plain in-memory fake never would on its own. */
class FakeTokenStore(private val simulateSilentSaveFailure: Boolean = false) : TokenStore {
    private var token: String? = null

    override suspend fun readToken(): String? = token

    override suspend fun saveToken(token: String): Boolean {
        if (simulateSilentSaveFailure) return false
        this.token = token
        return true
    }

    override suspend fun clear() {
        token = null
    }
}
