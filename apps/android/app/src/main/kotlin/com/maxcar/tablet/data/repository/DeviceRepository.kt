package com.maxcar.tablet.data.repository

import android.os.Build
import com.maxcar.tablet.BuildConfig
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.DeviceStateDao
import com.maxcar.tablet.data.local.DeviceStateEntity
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.local.PendingEventDao
import com.maxcar.tablet.data.local.PendingEventEntity
import com.maxcar.tablet.data.local.PlaybackEventDao
import com.maxcar.tablet.data.local.PlaybackEventEntity
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.local.TokenStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.EnrollRequest
import com.maxcar.tablet.data.remote.HeartbeatRequest
import com.maxcar.tablet.data.remote.PlaybackEventRequest
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
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
    private val playbackEventDao: PlaybackEventDao,
) {
    val isEnrolled: Flow<Boolean> = appPreferences.isEnrolled
    val deviceState: Flow<DeviceStateEntity?> = deviceStateDao.observe()
    val remoteConfig: Flow<RemoteConfigEntity?> = remoteConfigDao.observe()

    suspend fun installationId(): UUID = installationIdStore.getOrCreate()

    /** Exchanges a human-typed enrollment code for a device credential. */
    suspend fun enroll(code: String): Result<DeviceStateEntity> = runCatching {
        val installationId = installationIdStore.getOrCreate()
        // The OkHttp call inside DeviceApiClient blocks the calling thread
        // (client.newCall(request).execute()). Callers reach this from
        // viewModelScope, whose default dispatcher is Main — without this
        // withContext, a real device throws NetworkOnMainThreadException on
        // every attempt (Robolectric/JVM tests don't enforce that policy,
        // so this only surfaces on hardware).
        val response = withContext(Dispatchers.IO) {
            apiClient.enroll(
                EnrollRequest(
                    code = code,
                    installationId = installationId.toString(),
                    appVersion = BuildConfig.VERSION_NAME,
                    manufacturer = Build.MANUFACTURER,
                    model = Build.MODEL,
                    androidVersion = Build.VERSION.RELEASE,
                ),
            )
        }
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
    }.onFailure { logFailure("enroll", it) }

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
        playerState: String? = null,
        mediaReadyCount: Int? = null,
        manifestVersion: String? = null,
        currentCampaignId: String? = null,
        currentCreativeId: String? = null,
        lastError: String? = null,
        latitude: Double? = null,
        longitude: Double? = null,
        gpsAvailable: Boolean = false,
        locationAccuracyMeters: Double? = null,
        locationPermissionGranted: Boolean? = null,
        lastLocationError: String? = null,
        lastGeofenceEntryAt: String? = null,
        lastGeoCampaignId: String? = null,
        operationalStatus: String? = null,
        pendingEventCount: Int? = null,
        kioskLevel: String? = null,
    ): Result<Unit> {
        val sentAtMillis = System.currentTimeMillis()
        val clockSkewSeconds = appPreferences.clockSkewSnapshot()
        val token = secureTokenStore.readToken()
        if (token == null) {
            appPreferences.setEnrolled(false)
            return Result.failure(DeviceApiError.Unauthorized("Not enrolled."))
        }
        val result = runCatching {
            val response = withContext(Dispatchers.IO) {
                apiClient.heartbeat(
                    token,
                    HeartbeatRequest(
                        batteryLevel = batteryLevel,
                        networkType = networkType,
                        storageFreeBytes = storageFreeBytes,
                        appVersion = BuildConfig.VERSION_NAME,
                        deviceTime = Instant.now().toString(),
                        clientEventId = clientEventId.toString(),
                        playerState = playerState,
                        mediaReadyCount = mediaReadyCount,
                        manifestVersion = manifestVersion,
                        currentCampaignId = currentCampaignId,
                        currentCreativeId = currentCreativeId,
                        lastError = lastError,
                        latitude = latitude,
                        longitude = longitude,
                        gpsAvailable = gpsAvailable,
                        locationAccuracyMeters = locationAccuracyMeters,
                        locationPermissionGranted = locationPermissionGranted,
                        lastLocationError = lastLocationError,
                        lastGeofenceEntryAt = lastGeofenceEntryAt,
                        lastGeoCampaignId = lastGeoCampaignId,
                        operationalStatus = operationalStatus,
                        pendingEventCount = pendingEventCount,
                        clockSkewSeconds = clockSkewSeconds,
                        kioskLevel = kioskLevel,
                    ),
                )
            }
            deviceStateDao.get()?.let {
                deviceStateDao.upsert(
                    it.copy(lastHeartbeatAt = response.recordedAt, updatedAt = System.currentTimeMillis()),
                )
            }
            // Clock skew (MAX-009): the server's recordedAt is always its
            // own clock (never the tablet's, per record_device_heartbeat's
            // own contract) — comparing it to the tablet's clock right
            // before/after the round trip gives a usable, if approximate,
            // divergence estimate. Persisted for the *next* cycle's
            // heartbeat and for local-expiry decisions
            // (MediaDownloadManager.readyPlaylist) — never recomputed
            // mid-flight, since a single heartbeat can't measure its own
            // skew before it's answered.
            runCatching {
                val serverMillis = java.time.Instant.parse(response.recordedAt).toEpochMilli()
                val skewSeconds = ((sentAtMillis - serverMillis) / 1000).toInt()
                appPreferences.setClockSkewSeconds(skewSeconds)
            }
            Unit
        }
        result.onFailure { error ->
            logFailure("heartbeat", error)
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
                withContext(Dispatchers.IO) {
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
            }
            result.onSuccess {
                pendingEventDao.delete(event)
            }.onFailure { error ->
                logFailure("flushPendingEvents", error)
                pendingEventDao.recordAttempt(event.id, System.currentTimeMillis())
                if (error is DeviceApiError.Unauthorized) handleRevocation()
                return
            }
        }
    }

    /**
     * Queues one finalized playback attempt locally. Never talks to the
     * network directly — the player calls this the moment a video ends,
     * an image's duration elapses, or playback fails, and
     * [flushPlaybackEvents] uploads whatever's queued later. Returns the
     * event's own id so a caller (tests, diagnostics) can look it up.
     */
    suspend fun recordPlaybackEvent(
        campaignId: String,
        creativeId: String?,
        status: String,
        startedAt: String,
        completedAt: String?,
        durationMs: Long?,
        completionPercentage: Int?,
        failureReason: String?,
        offline: Boolean,
        clientEventId: UUID = UUID.randomUUID(),
    ): UUID {
        playbackEventDao.insert(
            PlaybackEventEntity(
                clientEventId = clientEventId.toString(),
                campaignId = campaignId,
                creativeId = creativeId,
                status = status,
                startedAt = startedAt,
                completedAt = completedAt,
                durationMs = durationMs,
                completionPercentage = completionPercentage,
                failureReason = failureReason,
                offline = offline,
                createdAt = System.currentTimeMillis(),
            ),
        )
        return clientEventId
    }

    /** Uploads queued playback events in one batch call, oldest first.
     * Successful (or already-recorded, from a retried upload) events are
     * removed locally; the rest stay queued for the next call. */
    suspend fun flushPlaybackEvents(limit: Int = 20) {
        val retentionCutoff = System.currentTimeMillis() - RETENTION_MILLIS
        playbackEventDao.pruneOlderThan(retentionCutoff)

        val token = secureTokenStore.readToken() ?: return
        val pending = playbackEventDao.oldest(limit)
        if (pending.isEmpty()) return

        val requests = pending.map { event ->
            PlaybackEventRequest(
                clientEventId = event.clientEventId,
                campaignId = event.campaignId,
                creativeId = event.creativeId,
                status = event.status,
                startedAt = event.startedAt,
                completedAt = event.completedAt,
                durationMs = event.durationMs,
                completionPercentage = event.completionPercentage,
                failureReason = event.failureReason,
                offline = event.offline,
            )
        }

        val result = runCatching {
            withContext(Dispatchers.IO) { apiClient.sendPlaybackEvents(token, requests) }
        }
        result.onSuccess { response ->
            response.results.filter { it.ok }.forEach {
                playbackEventDao.delete(it.clientEventId)
            }
        }.onFailure { error ->
            logFailure("flushPlaybackEvents", error)
            if (error is DeviceApiError.Unauthorized) {
                handleRevocation()
            } else {
                pending.forEach { playbackEventDao.recordAttempt(it.clientEventId) }
            }
        }
    }

    suspend fun refreshConfig(): Result<RemoteConfigEntity> {
        val token = secureTokenStore.readToken()
            ?: return Result.failure(DeviceApiError.Unauthorized("Not enrolled."))
        return runCatching {
            val response = withContext(Dispatchers.IO) { apiClient.getConfig(token) }
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
                maintenancePinHash = response.maintenancePinHash,
                maintenancePinSalt = response.maintenancePinSalt,
            )
            remoteConfigDao.upsert(config)
            config
        }.onFailure { error ->
            logFailure("refreshConfig", error)
            if (error is DeviceApiError.Unauthorized) handleRevocation()
        }
    }

    /** Local queue depth across both event kinds — reported on the
     * heartbeat (MAX-009's `pending_event_count`) so the panel can see a
     * backlog forming before it becomes an outage. */
    suspend fun pendingEventCount(): Int = pendingEventDao.count() + playbackEventDao.count()

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

    /** Logs only the operation name and the exception's own class — never a
     * message, cause, stack trace, request/response body, activation code
     * or device token. [DeviceApiError] messages already come straight from
     * the server, so even they aren't safe to log verbatim here. */
    private fun logFailure(step: String, error: Throwable) {
        android.util.Log.w(LOG_TAG, "$step failed: ${error::class.simpleName}")
    }

    private companion object {
        const val LOG_TAG = "MaxcarDeviceRepo"
        val RETENTION_MILLIS = TimeUnit.DAYS.toMillis(7)
    }
}
