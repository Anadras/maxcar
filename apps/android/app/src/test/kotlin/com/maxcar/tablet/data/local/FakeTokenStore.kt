package com.maxcar.tablet.data.local

/** In-memory [TokenStore] for tests: Robolectric has no usable
 * AndroidKeyStore, so [SecureTokenStore] itself isn't testable off-device. */
class FakeTokenStore : TokenStore {
    private var token: String? = null

    override fun readToken(): String? = token

    override fun saveToken(token: String) {
        this.token = token
    }

    override fun clear() {
        token = null
    }
}
