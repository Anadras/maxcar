package com.maxcar.tablet.ui.player

import android.content.Context
import android.os.Looper
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeDeviceKeyStore
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.geo.LocationEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.util.UUID

/**
 * MAX-012's circuit breaker (sections 7-11): a creative that keeps failing
 * to even start (here, a `localPath` that never resolves to a real file —
 * the same synchronous `finishCurrentItem(completed = false,
 * "missing_local_file")` path a hung decoder's watchdog timeout ultimately
 * also drives) must never be able to block the rest of the grade forever.
 *
 * The three timer-based watchdogs themselves (first-frame timeout,
 * duration watchdog, playback-stall watchdog — [PlayerViewModel.FIRST_FRAME_TIMEOUT_MS]
 * etc.) all funnel into this exact same `finishCurrentItem(completed =
 * false, reason)` → [PlayerViewModel] quarantine bookkeeping path once
 * they fire; what they can't be is fired *by* a Robolectric test, since
 * that requires a hardware decoder actually hanging on a real video file —
 * this suite proves the failure/quarantine/advance machinery those timers
 * ultimately drive, and MAX-012's physical test plan (section 35) is what
 * proves the timers themselves fire against the real regular02-class
 * failure.
 */
@RunWith(RobolectricTestRunner::class)
class PlayerViewModelWatchdogTest {

    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var deviceRepository: DeviceRepository
    private lateinit var mediaDownloadManager: MediaDownloadManager
    private lateinit var geoEngine: GeoEngine
    private lateinit var viewModel: PlayerViewModel

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        appPreferences = AppPreferences(
            PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.Unconfined)) { prefsFile },
        )

        val apiClient = DeviceApiClient(
            baseUrl = "http://localhost/",
            deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() },
        )

        deviceRepository = DeviceRepository(
            apiClient = apiClient,
            deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() },
            installationIdStore = InstallationIdStore(
                PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.Unconfined)) {
                    File.createTempFile("test-install-${UUID.randomUUID()}", ".preferences_pb")
                },
            ),
            appPreferences = appPreferences,
            deviceStateDao = db.deviceStateDao(),
            remoteConfigDao = db.remoteConfigDao(),
            pendingEventDao = db.pendingEventDao(),
            playbackEventDao = db.playbackEventDao(),
        )

        mediaDownloadManager = MediaDownloadManager(
            context = context,
            apiClient = apiClient,
            deviceIdentity = deviceRepository,
            playlistItemDao = db.playlistItemDao(),
            appPreferences = appPreferences,
            mediaQuarantineDao = db.mediaQuarantineDao(),
            minFreeBytes = -1,
        )

        val geoRulesSyncManager = GeoRulesSyncManager(
            context = context,
            apiClient = apiClient,
            deviceIdentity = deviceRepository,
            geoRuleDao = db.geoRuleDao(),
            minFreeBytes = -1,
        )
        geoEngine = GeoEngine(
            locationEngine = LocationEngine(context),
            geoRulesSyncManager = geoRulesSyncManager,
            geoRuleDao = db.geoRuleDao(),
            geofenceEventDao = db.geofenceEventDao(),
            scope = CoroutineScope(Dispatchers.IO),
        )

        viewModel = PlayerViewModel(
            deviceRepository = deviceRepository,
            mediaDownloadManager = mediaDownloadManager,
            appPreferences = appPreferences,
            appContext = context,
            geoEngine = geoEngine,
            restartSignal = MutableSharedFlow(),
            mediaQuarantineDao = db.mediaQuarantineDao(),
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun idleMain(millis: Long = 0) {
        if (millis > 0) {
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(millis))
        } else {
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    /** A "video" item whose [PlaylistItemEntity.localPath] never resolves
     * to a real file — [PlayerViewModel.playItem] catches this
     * synchronously (same as a real decoder's eventual failure would, just
     * without needing one), so this is a safe, deterministic way to drive
     * the *failure/quarantine* half of the watchdog machinery without a
     * real ExoPlayer decode. */
    private fun brokenVideoItem(creativeId: String, position: Int, sha256: String = "hash-v1") = PlaylistItemEntity(
        creativeId = creativeId,
        campaignId = "campaign-$creativeId",
        type = "video",
        mimeType = "video/mp4",
        durationSeconds = 10.0,
        fileSizeBytes = 100,
        sha256 = sha256,
        position = position,
        manifestVersion = "v1",
        downloadStatus = PlaylistItemEntity.STATUS_READY,
        localPath = "/nonexistent/${creativeId}.mp4",
        lastError = null,
        updatedAt = 0,
    )

    private fun healthyImageItem(creativeId: String, position: Int, durationSeconds: Double = 0.15) = PlaylistItemEntity(
        creativeId = creativeId,
        campaignId = "campaign-$creativeId",
        type = "image",
        mimeType = "image/jpeg",
        durationSeconds = durationSeconds,
        fileSizeBytes = 100,
        sha256 = "hash-$creativeId",
        position = position,
        manifestVersion = "v1",
        downloadStatus = PlaylistItemEntity.STATUS_READY,
        localPath = "/tmp/$creativeId.jpg",
        lastError = null,
        updatedAt = 0,
    )

    @Test
    fun `two consecutive failures for the same creative quarantine it`() = runBlocking {
        // A lone failing item would trip advance()'s own queue-wide
        // failure budget (consecutiveFailures >= queue.size) after just
        // one failure and never be retried at all — a second, always-good
        // item keeps the queue alive across laps so bad1's own,
        // per-creative quarantine count (tracked independently in
        // media_quarantine, not the queue-wide counter) can reach 2.
        db.playlistItemDao().upsertAll(
            listOf(brokenVideoItem("bad1", position = 1), healthyImageItem("good1", position = 2)),
        )

        withTimeout(8_000) {
            while ((db.mediaQuarantineDao().get("bad1")?.consecutiveFailures ?: 0) < 2) {
                idleMain(25)
                delay(25)
            }
        }

        val quarantine = db.mediaQuarantineDao().get("bad1")
        assertTrue(quarantine?.isActive(System.currentTimeMillis()) == true)
        assertEquals(2, quarantine?.consecutiveFailures)
        assertEquals("missing_local_file", quarantine?.lastFailureReason)
    }

    @Test
    fun `a quarantined creative is excluded from the ready queue so good items keep looping`() = runBlocking {
        db.playlistItemDao().upsertAll(
            listOf(
                healthyImageItem("good1", position = 1),
                brokenVideoItem("bad1", position = 2),
                healthyImageItem("good2", position = 3),
            ),
        )

        // Let it run long enough for bad1 to fail twice (quarantine) and
        // for good1/good2 to keep completing around it.
        withTimeout(8_000) {
            while (db.mediaQuarantineDao().countActive(System.currentTimeMillis()) == 0) {
                idleMain(25)
                delay(25)
            }
        }

        val completedGood = db.playbackEventDao().oldest(50)
            .count { it.status == "completed" && (it.campaignId == "campaign-good1" || it.campaignId == "campaign-good2") }
        assertTrue("expected good items to keep completing around the bad one, saw $completedGood", completedGood >= 2)

        // bad1 stops being attempted at all once quarantined: no third
        // failed event for it beyond the two that triggered quarantine.
        val badFailures = db.playbackEventDao().oldest(50).count { it.campaignId == "campaign-bad1" }
        assertEquals(2, badFailures)
    }

    @Test
    fun `a manifest sync with a new hash clears an existing quarantine`() = runBlocking {
        db.mediaQuarantineDao().upsert(
            com.maxcar.tablet.data.local.MediaQuarantineEntity(
                creativeId = "cr1",
                sha256 = "old-hash",
                consecutiveFailures = 2,
                lastFailureReason = "watchdog_timeout",
                lastFailureAtMillis = 0,
                quarantinedUntilMillis = System.currentTimeMillis() + 60_000,
            ),
        )
        assertTrue(db.mediaQuarantineDao().get("cr1")?.isActive(System.currentTimeMillis()) == true)

        // sync()'s hash-change check runs against whatever the manifest
        // says regardless of network success for the rest of the call —
        // exercised directly here rather than through a fake server, since
        // that plumbing is already covered by MediaDownloadManagerTest.
        db.mediaQuarantineDao().clearIfHashChanged("cr1", "new-hash")

        assertEquals(null, db.mediaQuarantineDao().get("cr1"))
    }
}
