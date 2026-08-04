package com.maxcar.tablet.data.repository

/** In-memory [DeviceIdentityProvider] for tests that exercise
 * MediaDownloadManager/GeoRulesSyncManager/GeoRepository/
 * DeviceCommandExecutor in isolation from a real [DeviceRepository] — those
 * classes only need "give me today's key_id" and "the server rejected it",
 * never the recovery logic itself (that's DeviceRepositoryTest's job). */
class FakeDeviceIdentityProvider(private var keyId: String? = "k1") : DeviceIdentityProvider {
    var unauthorizedCallCount: Int = 0
        private set

    override suspend fun currentKeyId(): String? = keyId

    override suspend fun handleUnauthorizedDeviceKey() {
        unauthorizedCallCount++
        keyId = null
    }

    fun setKeyId(value: String?) {
        keyId = value
    }
}
