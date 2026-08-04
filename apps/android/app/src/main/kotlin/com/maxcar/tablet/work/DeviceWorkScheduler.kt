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
 * Schedules the two workers MAX-006 needs. WorkManager's periodic work has
 * a hard 15-minute minimum interval and no guaranteed exact firing time —
 * this is a background heartbeat, not the precise, foreground-service
 * timing a future player session will need for playback telemetry.
 */
object DeviceWorkScheduler {
    private const val HEARTBEAT_WORK_NAME = "maxcar-heartbeat"
    private const val INITIAL_SYNC_WORK_NAME = "maxcar-initial-sync"
    private const val MEDIA_SYNC_WORK_NAME = "maxcar-media-sync"
    private const val MEDIA_SYNC_NOW_WORK_NAME = "maxcar-media-sync-now"
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

    fun scheduleHeartbeat(context: Context, intervalSeconds: Int) {
        val effectiveSeconds = maxOf(intervalSeconds.toLong(), MIN_INTERVAL_SECONDS)
        val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(
            effectiveSeconds,
            TimeUnit.SECONDS,
        )
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            HEARTBEAT_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /** Periodic grade sync, paced by the server's own `sync_interval_seconds`
     * (item 43) rather than a value the tablet decides for itself. */
    fun scheduleMediaSync(context: Context, intervalSeconds: Int) {
        val effectiveSeconds = maxOf(intervalSeconds.toLong(), MIN_INTERVAL_SECONDS)
        val request = PeriodicWorkRequestBuilder<MediaSyncWorker>(
            effectiveSeconds,
            TimeUnit.SECONDS,
        )
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            MEDIA_SYNC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /** "Sincronizar agora" (item 42): an immediate, one-time run alongside
     * the periodic schedule, never replacing it. */
    fun syncMediaNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<MediaSyncWorker>()
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            MEDIA_SYNC_NOW_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun cancelAll(context: Context) {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(HEARTBEAT_WORK_NAME)
            cancelUniqueWork(INITIAL_SYNC_WORK_NAME)
            cancelUniqueWork(MEDIA_SYNC_WORK_NAME)
            cancelUniqueWork(MEDIA_SYNC_NOW_WORK_NAME)
        }
    }

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
