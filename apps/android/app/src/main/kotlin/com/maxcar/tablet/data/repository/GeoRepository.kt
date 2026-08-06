package com.maxcar.tablet.data.repository

import com.maxcar.tablet.data.local.GeofenceEventDao
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.GeofenceEventRequest
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Uploads queued geofence transition events (MAX-008), mirroring
 * [DeviceRepository.flushPlaybackEvents] exactly: same batch-with-per-item-
 * result shape, same idempotent-by-clientEventId retry safety, same
 * bounded retention. Kept as its own small class rather than folded into
 * [DeviceRepository] since it owns a distinct local queue
 * ([GeofenceEventDao]) that only [com.maxcar.tablet.geo.GeoEngine] writes to.
 */
class GeoRepository(
    private val apiClient: DeviceApiClient,
    private val deviceIdentity: DeviceIdentityProvider,
    private val geofenceEventDao: GeofenceEventDao,
) {
    suspend fun pendingEventCount(): Int = geofenceEventDao.count()

    suspend fun flushGeofenceEvents(limit: Int = 20) {
        val retentionCutoff = System.currentTimeMillis() - RETENTION_MILLIS
        geofenceEventDao.pruneOlderThan(retentionCutoff)

        val keyId = deviceIdentity.currentKeyId() ?: return
        val pending = geofenceEventDao.oldest(limit)
        if (pending.isEmpty()) return

        val requests = pending.map { event ->
            GeofenceEventRequest(
                clientEventId = event.clientEventId,
                geofenceId = event.geofenceId,
                eventType = event.eventType,
                latitude = event.latitude,
                longitude = event.longitude,
                accuracyMeters = event.accuracyMeters,
                distanceMeters = event.distanceMeters,
                occurredAt = event.occurredAt,
            )
        }

        val result = runCatching {
            withContext(Dispatchers.IO) { apiClient.sendGeofenceEvents(keyId, requests) }
        }
        result.onSuccess { response ->
            // MAX-013: same reasoning as DeviceRepository.flushPlaybackEvents
            // — a permanent failure (geofenceId no longer exists) is
            // dropped, never retried forever ahead of newer events.
            response.results.filter { it.ok || it.permanent }.forEach {
                geofenceEventDao.delete(it.clientEventId)
            }
            response.results.filter { !it.ok && !it.permanent }.forEach {
                geofenceEventDao.recordAttempt(it.clientEventId)
            }
        }.onFailure { error ->
            android.util.Log.w(LOG_TAG, "flushGeofenceEvents failed: ${error::class.simpleName}")
            if (error is DeviceApiError.Unauthorized) {
                deviceIdentity.handleUnauthorizedDeviceKey()
            } else {
                pending.forEach { geofenceEventDao.recordAttempt(it.clientEventId) }
            }
        }
    }

    private companion object {
        const val LOG_TAG = "MaxcarGeoRepo"
        val RETENTION_MILLIS = TimeUnit.DAYS.toMillis(7)
    }
}
