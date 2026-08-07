package com.maxcar.tablet.kiosk

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class KioskLevelDetectorTest {

    @Test
    fun `reports NONE when nothing is engaged and there is no ready content`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val detector = KioskLevelDetector(context)

        val status = detector.currentStatus(
            hasReadyContent = false,
            kioskEnabled = true,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.NONE, status.level)
        assertNull(status.reason)
    }

    @Test
    fun `reports IMMERSIVE when only fullscreen is active, no Lock Task, no Device Owner`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val detector = KioskLevelDetector(context)

        // Robolectric's default ActivityManager/DevicePolicyManager shadows
        // report no Lock Task and no Device Owner unless a test explicitly
        // configures otherwise — the same "nothing achieved" state a real
        // device would report before any provisioning.
        val status = detector.currentStatus(
            hasReadyContent = true,
            kioskEnabled = true,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.IMMERSIVE, status.level)
        assertNull(status.reason)
    }

    private fun provisionAsDeviceOwner(context: Context) {
        val admin = ComponentName(context, AdminReceiver::class.java)
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        shadowOf(dpm).setDeviceOwner(admin)
    }

    @Test
    fun `reports DEVICE_OWNER_LOCKED when Device Owner and Lock Task are both actually engaged`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        provisionAsDeviceOwner(context)
        val activityManager = context.getSystemService(ActivityManager::class.java)
        shadowOf(activityManager).setLockTaskModeState(ActivityManager.LOCK_TASK_MODE_LOCKED)

        val status = KioskLevelDetector(context).currentStatus(
            hasReadyContent = true,
            kioskEnabled = true,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.DEVICE_OWNER_LOCKED, status.level)
        assertNull(status.reason)
    }

    @Test
    fun `reports MAINTENANCE_MODE whenever kiosk is suspended, even with ready content and Lock Task engaged`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        provisionAsDeviceOwner(context)
        val activityManager = context.getSystemService(ActivityManager::class.java)
        shadowOf(activityManager).setLockTaskModeState(ActivityManager.LOCK_TASK_MODE_LOCKED)

        val status = KioskLevelDetector(context).currentStatus(
            hasReadyContent = true,
            kioskEnabled = true,
            kioskSuspended = true,
        )

        assertEquals(KioskLevel.MAINTENANCE_MODE, status.level)
        assertNull(status.reason)
    }

    @Test
    fun `reports NO_CONTENT_MODE when Device Owner but nothing is ready to play`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        provisionAsDeviceOwner(context)

        val status = KioskLevelDetector(context).currentStatus(
            hasReadyContent = false,
            kioskEnabled = true,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.NO_CONTENT_MODE, status.level)
        assertNull(status.reason)
    }

    @Test
    fun `reports DEVICE_OWNER_UNLOCKED with kiosk_disabled_remotely when the fleet switch is off`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        provisionAsDeviceOwner(context)
        // Default shadow ActivityManager already reports LOCK_TASK_MODE_NONE.

        val status = KioskLevelDetector(context).currentStatus(
            hasReadyContent = true,
            kioskEnabled = false,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.DEVICE_OWNER_UNLOCKED, status.level)
        assertEquals(KioskReason.KIOSK_DISABLED_REMOTELY, status.reason)
    }

    @Test
    fun `reports DEVICE_OWNER_UNLOCKED with lock_task_not_engaged when nothing else explains it`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        provisionAsDeviceOwner(context)
        // Everything says it should be locked (ready content, kiosk
        // enabled, not suspended) and yet Lock Task itself isn't engaged —
        // the one case actually worth an operator's attention.

        val status = KioskLevelDetector(context).currentStatus(
            hasReadyContent = true,
            kioskEnabled = true,
            kioskSuspended = false,
        )

        assertEquals(KioskLevel.DEVICE_OWNER_UNLOCKED, status.level)
        assertEquals(KioskReason.LOCK_TASK_NOT_ENGAGED, status.reason)
    }

    @Test
    fun `wire values match the server's device_heartbeats kiosk_level and kiosk_reason check constraints`() {
        assertEquals("none", KioskLevel.NONE.toWireValue())
        assertEquals("immersive", KioskLevel.IMMERSIVE.toWireValue())
        assertEquals("lock_task", KioskLevel.LOCK_TASK.toWireValue())
        assertEquals("device_owner_locked", KioskLevel.DEVICE_OWNER_LOCKED.toWireValue())
        assertEquals("device_owner_unlocked", KioskLevel.DEVICE_OWNER_UNLOCKED.toWireValue())
        assertEquals("maintenance_mode", KioskLevel.MAINTENANCE_MODE.toWireValue())
        assertEquals("no_content_mode", KioskLevel.NO_CONTENT_MODE.toWireValue())
        assertEquals("kiosk_disabled_remotely", KioskReason.KIOSK_DISABLED_REMOTELY.toWireValue())
        assertEquals("lock_task_not_engaged", KioskReason.LOCK_TASK_NOT_ENGAGED.toWireValue())
    }
}
