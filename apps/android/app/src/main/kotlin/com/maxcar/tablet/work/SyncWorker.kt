package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.sync.SyncOutcome

/**
 * The single WorkManager entry point for MAX-009's Sync Coordinator — the
 * only worker that ever talks to the device API on a schedule. Replaces
 * the old MAX-006/007 pair (`HeartbeatWorker` + `MediaSyncWorker`), which
 * ran independently on their own cadences; see
 * [docs/architecture/ANDROID_SYNC.md] for why a single cadence, built
 * around the interval the heartbeat used to run at, replaces the previous
 * dual-cadence design.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MaxcarApplication).container
        return when (container.syncCoordinator.runCycle()) {
            SyncOutcome.SUCCESS -> Result.success()
            SyncOutcome.UNAUTHORIZED -> Result.failure()
            SyncOutcome.RETRY -> Result.retry()
        }
    }
}
