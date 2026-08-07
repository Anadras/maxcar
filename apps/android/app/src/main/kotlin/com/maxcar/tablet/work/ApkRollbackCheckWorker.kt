package com.maxcar.tablet.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.kiosk.RollbackOutcome

/** Runs [com.maxcar.tablet.kiosk.ApkRollback.checkAndRollbackIfNeeded] —
 * scheduled by [PackageReplacedReceiver], never anything in the app's own
 * normal startup path (see that class's doc for why). WorkManager retries
 * automatically on failure, so a rollback attempt that fails once (e.g. a
 * transient PackageInstaller session error) gets another chance rather
 * than silently giving up and leaving a broken build running. */
class ApkRollbackCheckWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MaxcarApplication).container
        return when (container.apkRollback.checkAndRollbackIfNeeded()) {
            is RollbackOutcome.RollbackFailed -> Result.retry()
            else -> Result.success()
        }
    }
}
