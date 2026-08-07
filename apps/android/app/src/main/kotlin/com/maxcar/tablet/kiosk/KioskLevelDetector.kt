package com.maxcar.tablet.kiosk

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context

/** The kiosk layers MAX-010/MAX-019 ask the panel to be able to
 * distinguish — what the tablet actually *achieved*, never what it merely
 * attempted. `startLockTask()` can silently no-op on a device without
 * Device Owner provisioning, so "we called startLockTask" is never treated
 * as proof it worked.
 *
 * MAX-019: on a Device Owner tablet, [isDeviceOwnerApp] alone used to
 * collapse every case into a single `DEVICE_OWNER` value — confirmed live
 * against TESTE01 that this was true in 100% of a full day's heartbeats,
 * including several multi-hour windows where `mLockTaskModeState` was
 * actually `NONE` (no ready content in the grade). The four
 * `DEVICE_OWNER_*`/`MAINTENANCE_MODE`/`NO_CONTENT_MODE` states below are
 * mutually exclusive and checked in priority order *before* falling back
 * to the raw OS lock-task state, so a `NONE`-equivalent report always
 * carries a reason instead of silently reading as full protection. */
enum class KioskLevel {
    // Non-Device-Owner fallback, unchanged since MAX-010.
    NONE,
    IMMERSIVE,
    LOCK_TASK,
    // MAX-019: the four Device Owner states.
    DEVICE_OWNER_LOCKED,
    DEVICE_OWNER_UNLOCKED,
    MAINTENANCE_MODE,
    NO_CONTENT_MODE,
}

/** Only ever populated alongside [KioskLevel.DEVICE_OWNER_UNLOCKED] — the
 * one bucket that isn't already self-explanatory the way MAINTENANCE_MODE
 * or NO_CONTENT_MODE are. [LOCK_TASK_NOT_ENGAGED] is the one genuinely
 * worth alerting on: every other reason here is an expected, known cause. */
enum class KioskReason {
    KIOSK_DISABLED_REMOTELY,
    LOCK_TASK_NOT_ENGAGED,
}

data class KioskStatusReport(val level: KioskLevel, val reason: KioskReason?)

/**
 * Queries Android's own runtime state rather than tracking a local flag,
 * so this can never drift from reality: [ActivityManager.getLockTaskModeState]
 * reports what the OS actually did with the last `startLockTask()` call,
 * and [DevicePolicyManager.isDeviceOwnerApp] reports actual Device Owner
 * status — never something this app decides for itself. See
 * docs/architecture/ANDROID_KIOSK.md.
 *
 * Purely a reporting layer: nothing here feeds back into
 * `MainActivity.applyKioskMode`'s `lockTaskEligible` gate, which remains
 * the sole source of truth for whether Lock Task is actually
 * requested/released (MAX-019 is diagnostics-only, never a behavior
 * change). [hasReadyContent]/[kioskEnabled]/[kioskSuspended] are
 * best-effort mirrors of that same gate's inputs, read from
 * [com.maxcar.tablet.sync.SyncCoordinator] (which has no Compose access of
 * its own) purely to explain an already-independently-detected
 * `DEVICE_OWNER_UNLOCKED`/`NO_CONTENT_MODE`/`MAINTENANCE_MODE` state —
 * never to decide it.
 */
class KioskLevelDetector(private val context: Context) {
    fun currentStatus(
        hasReadyContent: Boolean,
        kioskEnabled: Boolean,
        kioskSuspended: Boolean,
    ): KioskStatusReport {
        val devicePolicyManager = context.getSystemService(DevicePolicyManager::class.java)
        val isDeviceOwner = runCatching {
            devicePolicyManager?.isDeviceOwnerApp(context.packageName) ?: false
        }.getOrDefault(false)

        val activityManager = context.getSystemService(ActivityManager::class.java)
        val lockTaskState = runCatching { activityManager?.lockTaskModeState }.getOrNull()
        val lockTaskActive = lockTaskState != null && lockTaskState != ActivityManager.LOCK_TASK_MODE_NONE

        if (!isDeviceOwner) {
            val level = when {
                lockTaskActive -> KioskLevel.LOCK_TASK
                hasReadyContent -> KioskLevel.IMMERSIVE
                else -> KioskLevel.NONE
            }
            return KioskStatusReport(level, null)
        }

        if (kioskSuspended) return KioskStatusReport(KioskLevel.MAINTENANCE_MODE, null)
        if (!hasReadyContent) return KioskStatusReport(KioskLevel.NO_CONTENT_MODE, null)
        if (lockTaskActive) return KioskStatusReport(KioskLevel.DEVICE_OWNER_LOCKED, null)

        val reason = if (!kioskEnabled) {
            KioskReason.KIOSK_DISABLED_REMOTELY
        } else {
            KioskReason.LOCK_TASK_NOT_ENGAGED
        }
        return KioskStatusReport(KioskLevel.DEVICE_OWNER_UNLOCKED, reason)
    }
}

fun KioskLevel.toWireValue(): String = when (this) {
    KioskLevel.NONE -> "none"
    KioskLevel.IMMERSIVE -> "immersive"
    KioskLevel.LOCK_TASK -> "lock_task"
    KioskLevel.DEVICE_OWNER_LOCKED -> "device_owner_locked"
    KioskLevel.DEVICE_OWNER_UNLOCKED -> "device_owner_unlocked"
    KioskLevel.MAINTENANCE_MODE -> "maintenance_mode"
    KioskLevel.NO_CONTENT_MODE -> "no_content_mode"
}

fun KioskReason.toWireValue(): String = when (this) {
    KioskReason.KIOSK_DISABLED_REMOTELY -> "kiosk_disabled_remotely"
    KioskReason.LOCK_TASK_NOT_ENGAGED -> "lock_task_not_engaged"
}
