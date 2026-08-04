package com.maxcar.tablet.kiosk

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class KioskLevelDetectorTest {

    @Test
    fun `reports NONE when nothing is engaged and the caller says immersive is not active`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val detector = KioskLevelDetector(context)

        assertEquals(KioskLevel.NONE, detector.currentLevel(immersiveActive = false))
    }

    @Test
    fun `reports IMMERSIVE when only fullscreen is active, no Lock Task, no Device Owner`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val detector = KioskLevelDetector(context)

        // Robolectric's default ActivityManager/DevicePolicyManager shadows
        // report no Lock Task and no Device Owner unless a test explicitly
        // configures otherwise — the same "nothing achieved" state a real
        // device would report before any provisioning.
        assertEquals(KioskLevel.IMMERSIVE, detector.currentLevel(immersiveActive = true))
    }

    @Test
    fun `wire values match the server's device_heartbeats kiosk_level check constraint`() {
        assertEquals("none", KioskLevel.NONE.toWireValue())
        assertEquals("immersive", KioskLevel.IMMERSIVE.toWireValue())
        assertEquals("lock_task", KioskLevel.LOCK_TASK.toWireValue())
        assertEquals("device_owner", KioskLevel.DEVICE_OWNER.toWireValue())
    }
}
