package com.maxcar.tablet.kiosk

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Required to exist and be declared in the manifest *before*
 * `dpm set-device-owner` can ever succeed (MAX-011) — Android refuses to
 * grant Device Owner to a package with no admin receiver at all. Carries no
 * logic beyond confirming the transition happened: every actual policy
 * (`setLockTaskPackages`/`setLockTaskFeatures`) is applied from
 * `MainActivity` once `DevicePolicyManager.isDeviceOwnerApp` is true, not
 * from here, so it stays testable without an `Activity`/`Context` dance in
 * a receiver.
 */
class AdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(LOG_TAG, "device_admin_enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        // Only reachable via `dpm remove-active-admin` — Device Owner
        // status itself can't be revoked by the app going through this
        // callback, only by ADB or a factory reset (never triggered here).
        Log.w(LOG_TAG, "device_admin_disabled")
    }

    companion object {
        private const val LOG_TAG = "MaxcarAdminReceiver"

        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, AdminReceiver::class.java)
    }
}
