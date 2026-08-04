package com.maxcar.tablet.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.maxcar.tablet.MainActivity

/**
 * Restores the operational experience after the tablet reboots, without
 * waiting for connectivity: [MainActivity][com.maxcar.tablet.MainActivity]
 * itself decides what to show from local state (enrolled? a READY grade
 * already on disk?), so simply launching it is enough — no separate
 * "resume" logic is needed here. WorkManager's own periodic work already
 * re-arms itself across reboots, so heartbeat/media-sync don't need to be
 * rescheduled from this receiver.
 *
 * Some OEM battery/app-management skins (this pilot runs on a Black Shark
 * tablet) block BOOT_COMPLETED broadcasts or auto-start by default; see
 * docs/architecture/ANDROID_PILOT_TABLET_SETUP.md for the manual settings
 * this requires on that hardware.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)
    }
}
