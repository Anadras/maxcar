package com.maxcar.tablet.kiosk

import com.maxcar.tablet.data.local.AppPreferences
import java.io.File

sealed class RollbackOutcome {
    data object NothingPending : RollbackOutcome()
    data object StillWaiting : RollbackOutcome()
    data object NoBackupAvailable : RollbackOutcome()
    data object RolledBack : RollbackOutcome()
    data class RollbackFailed(val reason: String) : RollbackOutcome()
}

/**
 * MAX-014 item 7's "rollback lógico": an update is never trusted just
 * because [PackageInstaller][android.content.pm.PackageInstaller] reported
 * a successful commit — that only proves the *bytes* installed, not that
 * the new build actually runs. The real confirmation is a genuinely
 * successful sync cycle post-update (see [com.maxcar.tablet.sync.SyncCoordinator],
 * which clears [AppPreferences.clearPendingUpdate] the moment one
 * completes). If that confirmation never arrives within
 * [HEALTH_CHECK_TIMEOUT_MS] of the update being applied, this silently
 * reinstalls the exact APK that was running immediately before it.
 *
 * Invoked from [ApkRollbackCheckWorker], itself scheduled by
 * [PackageReplacedReceiver] on `ACTION_MY_PACKAGE_REPLACED` — deliberately
 * *not* invoked from anywhere in the app's own normal startup path,
 * because a build broken badly enough to need rolling back is exactly a
 * build that might crash before ever reaching that code. The receiver and
 * WorkManager's own persistence are what let this survive a crash loop the
 * main app process can't.
 */
class ApkRollback(
    private val appPreferences: AppPreferences,
    private val packageInstaller: PackageInstallerGateway,
    private val now: () -> Long = System::currentTimeMillis,
) {
    suspend fun checkAndRollbackIfNeeded(): RollbackOutcome {
        val pending = appPreferences.pendingUpdateSnapshot() ?: return RollbackOutcome.NothingPending
        val elapsedMs = now() - pending.setAtMillis
        if (elapsedMs < HEALTH_CHECK_TIMEOUT_MS) return RollbackOutcome.StillWaiting

        val backupFile = File(pending.previousApkBackupPath)
        if (!backupFile.exists()) {
            // Nothing to roll back to — clearing anyway so this doesn't
            // check forever; the new version is what keeps running,
            // whether or not it's actually healthy.
            appPreferences.clearPendingUpdate()
            return RollbackOutcome.NoBackupAvailable
        }

        return packageInstaller.install(backupFile).fold(
            onSuccess = {
                appPreferences.clearPendingUpdate()
                RollbackOutcome.RolledBack
            },
            onFailure = { RollbackOutcome.RollbackFailed(it.message ?: "rollback_failed") },
        )
    }

    companion object {
        // Generous relative to a normal sync cycle (heartbeat_interval_
        // seconds is at minimum WorkManager's own 15-minute periodic
        // floor, but the 30s foreground tick usually beats that) — this
        // is a genuine "the app never came back to life" signal, not a
        // race against normal sync timing.
        const val HEALTH_CHECK_TIMEOUT_MS = 5 * 60 * 1000L

        // Scheduled comfortably after HEALTH_CHECK_TIMEOUT_MS so the
        // worker essentially never fires "too early" (StillWaiting) in
        // practice — the elapsed check above is the real correctness
        // guarantee either way.
        const val HEALTH_CHECK_DELAY_MINUTES = 6L
    }
}
