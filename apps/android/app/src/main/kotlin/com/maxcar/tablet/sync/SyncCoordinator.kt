package com.maxcar.tablet.sync

import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.GeoRepository
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.domain.DeviceApiError
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.kiosk.KioskLevelDetector
import com.maxcar.tablet.kiosk.toWireValue
import com.maxcar.tablet.work.DeviceTelemetry

/** What a sync cycle decided, so the caller (a WorkManager worker) can map
 * it to the right `Result` without re-deriving the same error-type logic
 * every worker used to duplicate independently. */
enum class SyncOutcome { SUCCESS, UNAUTHORIZED, RETRY }

/**
 * MAX-009's single Sync Coordinator: the one place that runs a full sync
 * cycle, in a fixed priority order, so the app never has several
 * independent workers competing to decide what "sync" means. Everything
 * here runs off the main thread (called from a `CoroutineWorker`) — it
 * never touches `ExoPlayer` or Compose state directly, so priority 1
 * ("keep the player running") is satisfied structurally, not by an
 * explicit step: this coordinator simply has no way to block playback.
 *
 * Order (MAX-009's stated priority list, which wins over the conceptual
 * flow example whenever the two differ — see docs/architecture/ANDROID_SYNC.md):
 * 1. keep player running (implicit — see above)
 * 2. credential/heartbeat with current status
 * 3. pending events (playback, geofence, queued heartbeats)
 * 4. config + REGULAR manifest + GEO rules (version-aware; see each
 *    manager's own hash/version comparison)
 * 5. new media download (folded into step 4's sync() calls)
 * 6. cache cleanup (folded into step 4/5's atomic swap)
 * 7. remote commands (poll + execute + acknowledge)
 */
class SyncCoordinator(
    private val deviceRepository: DeviceRepository,
    private val mediaDownloadManager: MediaDownloadManager,
    private val geoRulesSyncManager: GeoRulesSyncManager,
    private val geoRepository: GeoRepository,
    private val geoEngine: GeoEngine,
    private val commandExecutor: DeviceCommandExecutor,
    private val appPreferences: AppPreferences,
    private val kioskLevelDetector: KioskLevelDetector,
    private val telemetryProvider: () -> DeviceTelemetry,
) {
    suspend fun runCycle(): SyncOutcome {
        val telemetry = telemetryProvider()
        val playerStatus = appPreferences.playerStatusSnapshot()
        val geoStatus = geoEngine.status.value
        val pendingCount = deviceRepository.pendingEventCount() + geoRepository.pendingEventCount()

        val heartbeatResult = deviceRepository.sendHeartbeat(
            batteryLevel = telemetry.batteryLevel,
            networkType = telemetry.networkType,
            storageFreeBytes = telemetry.storageFreeBytes,
            mediaReadyCount = mediaDownloadManager.readyCount(),
            manifestVersion = appPreferences.manifestVersionSnapshot(),
            playerState = playerStatus.state,
            currentCampaignId = playerStatus.campaignId,
            currentCreativeId = playerStatus.creativeId,
            lastError = playerStatus.lastError,
            latitude = geoStatus.lastLatitude,
            longitude = geoStatus.lastLongitude,
            gpsAvailable = geoStatus.active,
            locationAccuracyMeters = geoStatus.lastAccuracyMeters?.toDouble(),
            locationPermissionGranted = geoStatus.permissionGranted,
            lastLocationError = geoStatus.lastError,
            lastGeofenceEntryAt = geoStatus.lastGeofenceEntryAtMillis
                ?.let { java.time.Instant.ofEpochMilli(it).toString() },
            lastGeoCampaignId = geoStatus.lastGeoCampaignId,
            operationalStatus = operationalStatusFor(
                playerStatus.state, telemetry, appPreferences.diagnosticsOpenSnapshot(),
            ),
            pendingEventCount = pendingCount,
            kioskLevel = kioskLevelDetector.currentLevel(
                immersiveActive = playerStatus.state in IMMERSIVE_PLAYER_STATES,
            ).toWireValue(),
        )
        heartbeatResult.onFailure { error ->
            if (error is DeviceApiError.Unauthorized) return SyncOutcome.UNAUTHORIZED
            // Any other heartbeat failure (offline, timeout, server error)
            // means the rest of this cycle's network calls would fail the
            // same way — nothing left to usefully attempt this cycle.
            return if (error is DeviceApiError.NetworkUnavailable) SyncOutcome.SUCCESS else SyncOutcome.RETRY
        }

        // Priority 3: pending events, oldest first, regardless of source.
        deviceRepository.flushPendingEvents()
        deviceRepository.flushPlaybackEvents()
        geoRepository.flushGeofenceEvents()

        // Priority 4/5/6: config, REGULAR manifest + media, GEO rules +
        // media — each call is itself version/hash-aware and performs its
        // own atomic cache cleanup; see MediaDownloadManager/GeoRulesSyncManager.
        deviceRepository.refreshConfig()
        val regularResult = mediaDownloadManager.sync()
        geoRulesSyncManager.sync()

        // Priority 7: remote commands.
        commandExecutor.pollAndExecute()

        return regularResult.fold(
            onSuccess = { SyncOutcome.SUCCESS },
            onFailure = { error ->
                when (error) {
                    is DeviceApiError.Unauthorized -> SyncOutcome.UNAUTHORIZED
                    is DeviceApiError.NetworkUnavailable -> SyncOutcome.SUCCESS
                    else -> SyncOutcome.RETRY
                }
            },
        )
    }

    private fun operationalStatusFor(
        playerState: String?,
        telemetry: DeviceTelemetry,
        diagnosticsOpen: Boolean,
    ): String = when {
        diagnosticsOpen -> "maintenance"
        playerState == "empty" -> "no_content"
        playerState == "playing" && telemetry.networkType == "offline" -> "offline_playing"
        playerState == "playing" -> "playing"
        else -> "ready"
    }

    private companion object {
        val IMMERSIVE_PLAYER_STATES = setOf("playing")
    }
}
