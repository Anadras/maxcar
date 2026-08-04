package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.domain.DeviceApiError

/**
 * Fetches the manifest, downloads whatever changed, and validates it —
 * see [com.maxcar.tablet.data.repository.MediaDownloadManager]. Also syncs
 * GEO rules the same way (MAX-008): one worker, one schedule, matching
 * MAX-009's "avoid independent competing workers" direction, since both
 * are the same kind of work (fetch + download + validate) against the
 * server's single `sync_interval_seconds`. Scheduled periodically, run
 * once immediately after enrollment, and triggerable on demand from the
 * diagnostic screen's "Sincronizar agora".
 */
class MediaSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MaxcarApplication).container
        val regularResult = container.mediaDownloadManager.sync()
        val geoResult = container.geoRulesSyncManager.sync()
        // A REGULAR-grade failure is the one that matters for retry/backoff
        // decisions: GEO rules are a secondary concern for the pilot and
        // must never hold the primary grade's own sync outcome hostage.
        return regularResult.fold(
            onSuccess = {
                geoResult.fold(
                    onSuccess = { Result.success() },
                    onFailure = { error ->
                        if (error is DeviceApiError.Unauthorized) Result.failure() else Result.success()
                    },
                )
            },
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
