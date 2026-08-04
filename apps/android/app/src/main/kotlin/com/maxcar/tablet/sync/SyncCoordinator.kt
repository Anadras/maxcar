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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

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
    // MAX-011 Bloco B added a second, short-interval trigger
    // (ForegroundSyncLoop's 30s ticker + its ConnectivityManager callback)
    // alongside the existing WorkManager-scheduled SyncWorker/
    // InitialSyncWorker — both can legitimately fire around the same
    // moment (e.g. right after enrollment, or when connectivity flips).
    // Without this lock they'd run concurrently: two overlapping cycles
    // hitting the same Room tables and the same device token at once,
    // each with its own sequence of network calls whose combined worst-
    // case latency can stall the *next* tick well past its interval. A
    // mutex keeps the "one Sync Coordinator" guarantee real even when
    // multiple triggers fire close together — a caller that finds a cycle
    // already running just waits for it instead of starting a second one.
    private val cycleMutex = Mutex()

    /**
     * A hard ceiling on one cycle's total wall time, on top of every
     * individual HTTP call's own OkHttp timeout — belt and suspenders.
     * Individual timeouts bound *one* call; they don't bound a whole cycle
     * that makes 6-8 sequential calls, and they can't catch a genuinely
     * stuck suspend point that isn't a network call at all (e.g. Room
     * contention from two cycles that started before [cycleMutex] existed
     * and are both still mid-flight). Without this, a single wedged cycle
     * would hold [cycleMutex] forever and silently stop every future sync
     * — exactly the "heartbeats just stop for good" failure this guards
     * against.
     */
    suspend fun runCycle(): SyncOutcome = cycleMutex.withLock {
        try {
            // The withTimeout deadline is scheduled against whatever
            // dispatcher is current when it's set up. Every network call
            // inside runCycleLocked already escapes to Dispatchers.IO on
            // its own, but runCycleLocked's *own* suspension points
            // between those calls would otherwise leave the timeout
            // scheduled on the caller's dispatcher — under
            // kotlinx-coroutines-test's runTest, that's the virtual-time
            // TestDispatcher, whose idle auto-advance can fast-forward
            // straight past the deadline the instant real IO work (which
            // it can't see) starts, firing the timeout instantly instead
            // of after CYCLE_TIMEOUT_MS. Switching to Dispatchers.IO
            // first keeps the deadline on a real clock in both
            // production and tests.
            withContext(Dispatchers.IO) {
                withTimeout(CYCLE_TIMEOUT_MS) { runCycleLocked() }
            }
        } catch (e: TimeoutCancellationException) {
            SyncOutcome.RETRY
        }
    }

    private suspend fun runCycleLocked(): SyncOutcome {
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
            // Only a server-confirmed 401 means UNAUTHORIZED. A merely
            // unreadable local credential (CredentialUnavailable) is
            // retried instead — it was never actually rejected by the
            // server, so treating it the same way would wrongly desync
            // the tablet's enrollment state (see
            // DeviceRepository.markCredentialMissingIfEnrolled).
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
        val geoResult = geoRulesSyncManager.sync()

        // Priority 7: remote commands.
        commandExecutor.pollAndExecute()

        val syncErrors = listOfNotNull(
            regularResult.exceptionOrNull(),
            geoResult.exceptionOrNull(),
        )
        return when {
            syncErrors.any { it is DeviceApiError.Unauthorized } -> SyncOutcome.UNAUTHORIZED
            syncErrors.isEmpty() -> SyncOutcome.SUCCESS
            syncErrors.all { it is DeviceApiError.NetworkUnavailable } -> SyncOutcome.SUCCESS
            else -> SyncOutcome.RETRY
        }
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
        // Generous relative to OkHttp's own per-call timeouts (10s connect
        // + 20s read + 15s write, and a cycle makes several such calls
        // sequentially) but still far below the 30s foreground tick
        // interval's next-cycle expectation, and nowhere near WorkManager's
        // own execution limits.
        const val CYCLE_TIMEOUT_MS = 90_000L
    }
}
