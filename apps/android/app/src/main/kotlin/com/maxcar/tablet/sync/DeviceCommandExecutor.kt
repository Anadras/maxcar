package com.maxcar.tablet.sync

import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.DeviceCommandItem
import com.maxcar.tablet.data.repository.DeviceIdentityProvider
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext

/**
 * The small, closed set of remote operations a fleet manager can queue for
 * a device (MAX-009 item 51) — never arbitrary shell, never a free-text
 * command the tablet blindly runs. Each `command_type` the server can
 * issue has exactly one hardcoded branch here; an unrecognized type (a
 * future server enum value an older app build doesn't know about yet) is
 * acknowledged as failed rather than guessed at.
 */
class DeviceCommandExecutor(
    private val apiClient: DeviceApiClient,
    private val deviceIdentity: DeviceIdentityProvider,
    private val mediaDownloadManager: MediaDownloadManager,
    private val geoRulesSyncManager: GeoRulesSyncManager,
    private val appPreferences: AppPreferences,
    private val remoteConfigDao: RemoteConfigDao,
) {
    private val _restartPlayerSignal = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** [com.maxcar.tablet.ui.player.PlayerViewModel] collects this to reset
     * to the start of the current grade — decoupled from any Activity
     * reference, since this executor runs from a background worker. */
    val restartPlayerSignal: SharedFlow<Unit> = _restartPlayerSignal

    suspend fun pollAndExecute() {
        val keyId = deviceIdentity.currentKeyId() ?: return
        val response = runCatching {
            withContext(Dispatchers.IO) { apiClient.getPendingCommands(keyId) }
        }.getOrNull() ?: return

        for (command in response.commands) {
            val (status, result) = execute(command)
            runCatching {
                withContext(Dispatchers.IO) {
                    apiClient.acknowledgeCommand(keyId, command.commandId, status, result)
                }
            }
        }
    }

    private suspend fun execute(command: DeviceCommandItem): Pair<String, String?> = runCatching {
        when (command.commandType) {
            "sync_now" -> Unit // Already inside a sync cycle by construction; nothing extra to do.
            "restart_player" -> _restartPlayerSignal.emit(Unit)
            "clear_obsolete_media" -> {
                // Re-runs the same atomic-swap sync both managers already
                // do every cycle: the command's effect is guaranteeing an
                // immediate reconciliation pass instead of waiting for the
                // next scheduled one.
                mediaDownloadManager.sync()
                geoRulesSyncManager.sync()
            }
            "enter_maintenance" -> appPreferences.setMaintenanceRequested(true)
            "exit_maintenance" -> appPreferences.setMaintenanceRequested(false)
            "update_config" -> Unit // SyncCoordinator already refreshes config every cycle.
            // MAX-011: un-pins Lock Task for one configured maintenance
            // window (default 5 min, see RemoteConfigEntity) without
            // opening the local diagnostics screen — a fleet manager can
            // free the tablet from the panel, but reaching diagnostics
            // itself still requires the physical 5-tap + PIN gesture,
            // preserving the existing "remote never bypasses the physical
            // PIN gate" rule documented in ANDROID_MAINTENANCE_MODE.md.
            "disable_kiosk_temporarily" -> {
                val timeoutSeconds = remoteConfigDao.get()?.maintenanceTimeoutSeconds
                    ?: RemoteConfigEntity.DEFAULT_MAINTENANCE_TIMEOUT_SECONDS
                appPreferences.setKioskSuspendedUntil(
                    System.currentTimeMillis() + timeoutSeconds * 1000L,
                )
            }
            // Idempotent by construction (both just clear the same
            // deadline): "enable_kiosk" and "reenter_kiosk" are the same
            // operation under two names the panel exposes for different
            // operator intents (turning kiosk back on vs. cutting a
            // temporary exit short).
            "enable_kiosk", "reenter_kiosk" -> appPreferences.setKioskSuspendedUntil(null)
            else -> error("unknown_command_type")
        }
        COMPLETED to null
    }.getOrElse { error -> FAILED to (error.message ?: error::class.simpleName ?: "error") }

    private companion object {
        const val COMPLETED = "completed"
        const val FAILED = "failed"
    }
}
