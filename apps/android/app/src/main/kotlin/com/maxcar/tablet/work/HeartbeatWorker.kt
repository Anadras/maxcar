package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.domain.DeviceApiError

/**
 * Reports one heartbeat and, while it's at it, tries to flush anything
 * queued from earlier failed attempts. Scheduled periodically by
 * [DeviceWorkScheduler]; WorkManager decides the exact firing time within
 * its constraints, so this is "roughly every N minutes", not a precise
 * timer — the real-time picture belongs to a future foreground player
 * session, not this background worker.
 */
class HeartbeatWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val repository = (applicationContext as MaxcarApplication).container.deviceRepository
        val telemetry = DeviceTelemetry.collect(applicationContext)

        repository.flushPendingEvents()

        val result = repository.sendHeartbeat(
            batteryLevel = telemetry.batteryLevel,
            networkType = telemetry.networkType,
            storageFreeBytes = telemetry.storageFreeBytes,
        )

        return result.fold(
            onSuccess = { Result.success() },
            onFailure = { error ->
                when (error) {
                    // Already queued locally by the repository; nothing left
                    // to retry right now, and WorkManager's own periodic
                    // schedule will try again next cycle regardless.
                    is DeviceApiError.NetworkUnavailable -> Result.success()
                    // Needs re-enrollment: retrying won't help until then.
                    is DeviceApiError.Unauthorized -> Result.failure()
                    else -> Result.retry()
                }
            },
        )
    }
}
