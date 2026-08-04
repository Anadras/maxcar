package com.maxcar.tablet.work

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class DeviceWorkSchedulerTest {

    private lateinit var context: Context
    private lateinit var workManager: WorkManager

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        val config = Configuration.Builder()
            .setExecutor(SynchronousExecutor())
            .build()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
        workManager = WorkManager.getInstance(context)
    }

    @Test
    fun `scheduleSync enqueues a single periodic worker under the maxcar-sync name`() {
        DeviceWorkScheduler.scheduleSync(context, intervalSeconds = 900)

        val infos = workManager.getWorkInfosForUniqueWork("maxcar-sync").get()

        assertEquals(1, infos.size)
        assertEquals(WorkInfo.State.ENQUEUED, infos.first().state)
    }

    @Test
    fun `scheduleSync clamps intervals below WorkManager's 15-minute minimum`() {
        // WorkManager itself would throw for an interval this short; the
        // scheduler must clamp it before the request is even built.
        DeviceWorkScheduler.scheduleSync(context, intervalSeconds = 60)

        val infos = workManager.getWorkInfosForUniqueWork("maxcar-sync").get()

        assertEquals(1, infos.size)
        assertTrue(infos.first().periodicityInfo!!.repeatIntervalMillis >= TimeUnit.MINUTES.toMillis(15))
    }

    @Test
    fun `scheduleInitialSync enqueues a one-time worker under the maxcar-initial-sync name`() {
        DeviceWorkScheduler.scheduleInitialSync(context)

        val infos = workManager.getWorkInfosForUniqueWork("maxcar-initial-sync").get()

        assertEquals(1, infos.size)
    }

    @Test
    fun `syncNow enqueues a one-time worker without disturbing the periodic schedule`() {
        DeviceWorkScheduler.scheduleSync(context, intervalSeconds = 900)

        DeviceWorkScheduler.syncNow(context)

        val periodicInfos = workManager.getWorkInfosForUniqueWork("maxcar-sync").get()
        val nowInfos = workManager.getWorkInfosForUniqueWork("maxcar-sync-now").get()
        assertEquals(1, periodicInfos.size)
        assertEquals(1, nowInfos.size)
    }

    @Test
    fun `cancelAll removes the sync and initial-sync work`() {
        DeviceWorkScheduler.scheduleInitialSync(context)
        DeviceWorkScheduler.scheduleSync(context, intervalSeconds = 900)

        DeviceWorkScheduler.cancelAll(context)

        val syncInfos = workManager.getWorkInfosForUniqueWork("maxcar-sync").get()
        val initialInfos = workManager.getWorkInfosForUniqueWork("maxcar-initial-sync").get()
        assertTrue(syncInfos.all { it.state == WorkInfo.State.CANCELLED })
        assertTrue(initialInfos.all { it.state == WorkInfo.State.CANCELLED })
    }
}
