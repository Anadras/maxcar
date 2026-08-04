package com.maxcar.tablet.kiosk

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context

/** The three kiosk layers MAX-010 asks the panel to be able to
 * distinguish — what the tablet actually *achieved*, never what it merely
 * attempted. `startLockTask()` can silently no-op on a device without
 * Device Owner provisioning, so "we called startLockTask" is never treated
 * as proof it worked. */
enum class KioskLevel { NONE, IMMERSIVE, LOCK_TASK, DEVICE_OWNER }

/**
 * Queries Android's own runtime state rather than tracking a local flag,
 * so this can never drift from reality: [ActivityManager.getLockTaskModeState]
 * reports what the OS actually did with the last `startLockTask()` call,
 * and [DevicePolicyManager.isDeviceOwnerApp] reports actual Device Owner
 * status — never something this app decides for itself. See
 * docs/architecture/ANDROID_KIOSK.md.
 */
class KioskLevelDetector(private val context: Context) {
    fun currentLevel(immersiveActive: Boolean): KioskLevel {
        val devicePolicyManager = context.getSystemService(DevicePolicyManager::class.java)
        val isDeviceOwner = runCatching {
            devicePolicyManager?.isDeviceOwnerApp(context.packageName) ?: false
        }.getOrDefault(false)
        if (isDeviceOwner) return KioskLevel.DEVICE_OWNER

        val activityManager = context.getSystemService(ActivityManager::class.java)
        val lockTaskState = runCatching { activityManager?.lockTaskModeState }.getOrNull()
        val lockTaskActive = lockTaskState != null && lockTaskState != ActivityManager.LOCK_TASK_MODE_NONE
        if (lockTaskActive) return KioskLevel.LOCK_TASK

        return if (immersiveActive) KioskLevel.IMMERSIVE else KioskLevel.NONE
    }
}

fun KioskLevel.toWireValue(): String = when (this) {
    KioskLevel.NONE -> "none"
    KioskLevel.IMMERSIVE -> "immersive"
    KioskLevel.LOCK_TASK -> "lock_task"
    KioskLevel.DEVICE_OWNER -> "device_owner"
}
