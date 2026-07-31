package com.maxcar.tablet.data.repository

import android.os.Build
import com.maxcar.tablet.BuildConfig
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.DeviceStateDao
import com.maxcar.tablet.data.local.DeviceStateEntity
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.local.PendingEventDao
import com.maxcar.tablet.data.local.PendingEventEntity
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.local.TokenStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.EnrollRequest
import com.maxcar.tablet.data.remote.HeartbeatRequest
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * The single place that knows how enrollment, the device credential, the
 * heartbeat queue and remote config relate to each other. UI and
 * WorkManager workers both go through this, never through
 * [DeviceApiClient] or the DAOs directly.
 */
class DeviceRepository(
    private val apiClient: DeviceApiClient,
    private val installationIdStore: InstallationIdStore,
    private val secureTokenStore: TokenStore,
    private val appPreferences: AppPreferences,
    private val deviceStateDao: DeviceStateDao,
    private val remoteConfigDao: RemoteConfigDao,
    private val pendingEventDao: PendingEventDao,
) {
    val isEnrolled: Flow<Boolean> = appPreferences.isEnrolled
    val deviceState: Flow<DeviceStateEntity?> = deviceStateDao.observe()
    val remoteConfig: Flow<RemoteConfigEntity?> = remoteConfigDao.observe()

    suspend fun installationId(): UUID = installationIdStore.getOrCreate()

    /** Exchanges a human-typed enrollment code for a device credential. */
    suspend fun enroll(code: String): Result<DeviceStateEntity> = runCatching {
        val installationId = installationIdStore.getOrCreate()
        val response = apiClient.enroll(
            EnrollRequest(
                code = code,
                installationId = installationId.toString(),
                appVersion = BuildConfig.VERSION_NAME,
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                androidVersion = Build.VERSION.RELEASE,
            ),
        )
        secureTokenStore.saveToken(response.deviceToken)
        val state = DeviceStateEntity(
            deviceId = response.deviceId,
            deviceCode = response.deviceCode,
            vehicleId = response.vehicleId,
            vehicleCode = response.vehicleCode,
            lastHeartbeatAt = null,
            lastSyncAt = null,
            updatedAt = System.currentTimeMillis(),
        )
        deviceStateDao.upsert(state)
        appPreferences.setEnrolled(true)
        state
    }

    /**
     * Sends one heartbeat. On success, clears the corresponding pending
     * event if this was a retry. On [DeviceApiError.Unauthorized] (revoked
     * or invalid credential), the device falls back to "needs
     * re-enrollment" — but its local data is left alone; only an explicit
     * revocation response does this, never a network failure or timeout.
     */
    suspend fun sendHeartbeat(
        batteryLevel: Int?,
        networkType: String,
        storageFreeBytes: Long?,
        clientEventId: UUID = UUID.randomUUID(),
    ): Result<Unit> {
        val token = secureTokenStore.readToken()
        if (token == null) {
            appPreferences.setEnrolled(false)
            return Result.failure(DeviceApiError.Unauthorized("Not enrolled."))
        }
        val result = runCatching {
            val response = apiClient.heartbeat(
                token,
                HeartbeatRequest(
                    batteryLevel = batteryLevel,
                    networkType = networkType,
                    storageFreeBytes = storageFreeBytes,
                    appVersion = BuildConfig.VERSION_NAME,
                    deviceTime = Instant.now().toString(),
                    clientEventId = clientEventId.toString(),
                ),
            )
            deviceStateDao.get()?.let {
                deviceStateDao.upsert(
                    it.copy(lastHeartbeatAt = response.recordedAt, updatedAt = System.currentTimeMillis()),
                )
            }
            Unit
        }
        result.onFailure { error ->
            when (error) {
                is DeviceApiError.Unauthorized -> handleRevocation()
                is DeviceApiError.NetworkUnavailable ->
                    queuePendingHeartbeat(batteryLevel, networkType, storageFreeBytes, clientEventId)
                else -> Unit
            }
        }
        return result
    }

    /** Attempts to flush queued heartbeats, oldest first. Stops at the
     * first failure so events are never sent out of order. */
    suspend fun flushPendingEvents(limit: Int = 20) {
        val retentionCutoff = System.currentTimeMillis() - RETENTION_MILLIS
        pendingEventDao.pruneOlderThan(retentionCutoff)

        val token = secureTokenStore.readToken() ?: return
        for (event in pendingEventDao.oldest(limit)) {
            val result = runCatching {
                apiClient.heartbeat(
                    token,
                    HeartbeatRequest(
                        batteryLevel = event.batteryLevel,
                        networkType = event.networkType,
                        storageFreeBytes = event.storageFreeBytes,
                        appVersion = event.appVersion,
                        deviceTime = Instant.ofEpochMilli(event.deviceTimeMillis).toString(),
                        clientEventId = event.clientEventId,
                    ),
                )
            }
            result.onSuccess {
                pendingEventDao.delete(event)
            }.onFailure { error ->
                pendingEventDao.recordAttempt(event.id, System.currentTimeMillis())
                if (error is DeviceApiError.Unauthorized) handleRevocation()
                return
            }
        }
    }

    suspend fun refreshConfig(): Result<RemoteConfigEntity> {
        val token = secureTokenStore.readToken()
            ?: return Result.failure(DeviceApiError.Unauthorized("Not enrolled."))
        return runCatching {
            val response = apiClient.getConfig(token)
            deviceStateDao.get()?.let {
                deviceStateDao.upsert(it.copy(lastSyncAt = Instant.now().toString()))
            }
            val config = RemoteConfigEntity(
                heartbeatIntervalSeconds = response.heartbeatIntervalSeconds,
                syncIntervalSeconds = response.syncIntervalSeconds,
                kioskEnabled = response.kioskEnabled,
                loggingLevel = response.loggingLevel,
                configVersion = response.configVersion,
                updatedAt = System.currentTimeMillis(),
            )
            remoteConfigDao.upsert(config)
            config
        }.onFailure { error ->
            if (error is DeviceApiError.Unauthorized) handleRevocation()
        }
    }

    suspend fun currentHeartbeatIntervalSeconds(): Long =
        (remoteConfigDao.get() ?: RemoteConfigEntity.defaults())
            .heartbeatIntervalSeconds.toLong()

    /** A revoked/invalid credential means "needs re-enrollment", not "data
     * loss": we clear only the secret and the enrolled flag. Device/vehicle
     * history and the pending queue are left alone; re-enrollment repopulates
     * DeviceStateEntity from the server's response like the first time. */
    private suspend fun handleRevocation() {
        secureTokenStore.clear()
        appPreferences.setEnrolled(false)
    }

    private suspend fun queuePendingHeartbeat(
        batteryLevel: Int?,
        networkType: String,
        storageFreeBytes: Long?,
        clientEventId: UUID,
    ) {
        pendingEventDao.insert(
            PendingEventEntity(
                clientEventId = clientEventId.toString(),
                batteryLevel = batteryLevel,
                networkType = networkType,
                storageFreeBytes = storageFreeBytes,
                appVersion = BuildConfig.VERSION_NAME,
                deviceTimeMillis = System.currentTimeMillis(),
                createdAt = System.currentTimeMillis(),
            ),
        )
    }

    private companion object {
        val RETENTION_MILLIS = TimeUnit.DAYS.toMillis(7)
    }
}
