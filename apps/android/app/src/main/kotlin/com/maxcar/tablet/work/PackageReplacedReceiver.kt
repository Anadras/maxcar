package com.maxcar.tablet.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.maxcar.tablet.MainActivity
import com.maxcar.tablet.kiosk.ApkRollback
import java.util.concurrent.TimeUnit

/**
 * MAX-014's rollback watchdog entry point — and, just as critically, the
 * only thing that gets the tablet back into kiosk mode after
 * [com.maxcar.tablet.kiosk.ApkUpdateManager] applies a silent update.
 * `ACTION_MY_PACKAGE_REPLACED` is a protected system broadcast sent to
 * this exact app the instant *any* update to it finishes installing.
 *
 * Physically confirmed on TESTE01 (2026-08-06): a `PackageInstaller`-
 * committed update kills the running process but does **not** relaunch
 * it the way `adb install -r` followed by a manual `am start` does — the
 * tablet was left sitting at the plain Android home launcher, fully out
 * of Lock Task, until this fix. Every OTA update would otherwise have
 * silently broken kiosk containment. This receiver now relaunches
 * [MainActivity] itself, same as [BootCompletedReceiver] does after a
 * reboot — deliberately kept to just these two calls (relaunch, then
 * schedule the health-check worker) so it stays this reliable even when
 * the new build is broken badly enough to crash almost immediately: a
 * receiver with more logic in it would be exactly as fragile as the app
 * it's meant to watch. WorkManager persists the scheduled job to disk, so
 * the rollback check still fires even if this process (or several
 * subsequent crash-looping ones) dies before its delay elapses.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)

        val request = OneTimeWorkRequestBuilder<ApkRollbackCheckWorker>()
            .setInitialDelay(ApkRollback.HEALTH_CHECK_DELAY_MINUTES, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            ROLLBACK_CHECK_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private companion object {
        const val ROLLBACK_CHECK_WORK_NAME = "maxcar-apk-rollback-check"
    }
}
