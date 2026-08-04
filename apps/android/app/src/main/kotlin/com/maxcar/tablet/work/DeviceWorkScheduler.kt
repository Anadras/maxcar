package com.maxcar.tablet.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules the app's background work. MAX-009 collapsed the previous
 * separate heartbeat and media-sync periodic jobs into one
 * ([SyncWorker], running [com.maxcar.tablet.sync.SyncCoordinator]) — the
 * whole point of a single Sync Coordinator is that there is exactly one
 * periodic schedule to reason about, not several independently-timed
 * workers that can race or duplicate work. WorkManager's periodic work has
 * a hard 15-minute minimum interval and no guaranteed exact firing time —
 * a background sync, not the precise, foreground-service timing a
 * continuously running player/GPS session needs (see
 * `geo.LocationForegroundService`).
 */
object DeviceWorkScheduler {
    private const val SYNC_WORK_NAME = "maxcar-sync"
    private const val INITIAL_SYNC_WORK_NAME = "maxcar-initial-sync"
    private const val SYNC_NOW_WORK_NAME = "maxcar-sync-now"
    private val MIN_INTERVAL_SECONDS = TimeUnit.MINUTES.toSeconds(15)

    fun scheduleInitialSync(context: Context) {
        val request = OneTimeWorkRequestBuilder<InitialSyncWorker>()
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            INITIAL_SYNC_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    /** Periodic full sync cycle, paced by the server's own
     * `heartbeat_interval_seconds` (the more frequent of the two intervals
     * MAX-006/007 used to schedule separately) — never decided by the
     * tablet itself. Every cycle now includes a heartbeat (Sync
     * Coordinator priority 2), so running at the old heartbeat cadence
     * keeps that guarantee while syncing content more often than before;
     * REGULAR/GEO downloads are hash/version-aware, so an unchanged grade
     * costs almost nothing extra to check that often. */
    fun scheduleSync(context: Context, intervalSeconds: Int) {
        val effectiveSeconds = maxOf(intervalSeconds.toLong(), MIN_INTERVAL_SECONDS)
        val request = PeriodicWorkRequestBuilder<SyncWorker>(
            effectiveSeconds,
            TimeUnit.SECONDS,
        )
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SYNC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /** "Sincronizar agora": an immediate, one-time run alongside the
     * periodic schedule, never replacing it. */
    fun syncNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            SYNC_NOW_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun cancelAll(context: Context) {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(SYNC_WORK_NAME)
            cancelUniqueWork(INITIAL_SYNC_WORK_NAME)
            cancelUniqueWork(SYNC_NOW_WORK_NAME)
        }
    }

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
