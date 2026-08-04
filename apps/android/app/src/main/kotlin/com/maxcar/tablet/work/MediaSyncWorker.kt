package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.domain.DeviceApiError

/**
 * Fetches the manifest, downloads whatever changed, and validates it —
 * see [com.maxcar.tablet.data.repository.MediaDownloadManager]. Scheduled
 * periodically per the server's `sync_interval_seconds`, run once
 * immediately after enrollment, and triggerable on demand from the
 * diagnostic screen's "Sincronizar agora".
 */
class MediaSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val manager = (applicationContext as MaxcarApplication).container.mediaDownloadManager
        val result = manager.sync()
        return result.fold(
            onSuccess = { Result.success() },
            onFailure = { error ->
                when (error) {
                    is DeviceApiError.NetworkUnavailable -> Result.success()
                    is DeviceApiError.Unauthorized -> Result.failure()
                    else -> Result.retry()
                }
            },
        )
    }
}
