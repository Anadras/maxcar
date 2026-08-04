package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication

/**
 * Runs once, right after enrollment succeeds: fetches remote config so the
 * device knows its real heartbeat/sync interval before
 * [DeviceWorkScheduler] schedules the recurring heartbeat work using it.
 */
class InitialSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MaxcarApplication).container
        val result = container.deviceRepository.refreshConfig()
        return result.fold(
            onSuccess = {
                DeviceWorkScheduler.scheduleSync(
                    applicationContext,
                    it.heartbeatIntervalSeconds,
                )
                DeviceWorkScheduler.syncNow(applicationContext)
                Result.success()
            },
            onFailure = { Result.retry() },
        )
    }
}
