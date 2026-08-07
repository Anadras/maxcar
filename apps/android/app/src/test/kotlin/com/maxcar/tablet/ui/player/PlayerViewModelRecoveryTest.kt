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
 * MAX-014: a real pilot incident on TESTE01 (2026-08-06) showed that once
 * every item in a small grade had failed at least once, [PlayerViewModel]
 * gave up permanently — `advance()`'s old queue-wide failure branch set
 * [PlayerUiState.Empty] and simply returned, with nothing left to ever call
 * it again. Neither a quarantine window elapsing nor a fresh manifest
 * syncing in the background writes anything Room would treat as "changed"
 * for an already-failed item, so nothing woke the old code back up short of
 * a remote restart_player command or a manual app restart.
 *
 * This suite proves the replacement: entering [PlayerUiState.Fallback]
 * starts a polling loop (interval overridden to be test-fast) that keeps
 * re-checking for playable content and resumes automatically the moment
 * something is — without any external nudge.
 */
@RunWith(RobolectricTestRunner::class)
class PlayerViewModelRecoveryTest {

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
            // Real production value is 30s — far too slow for a unit
            // test's own timeout budget; this is exactly what the
            // constructor parameter exists for.
            recoveryRetryIntervalMs = 40L,
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

    private fun brokenVideoItem(creativeId: String, position: Int) = PlaylistItemEntity(
        creativeId = creativeId,
        campaignId = "campaign-$creativeId",
        type = "video",
        mimeType = "video/mp4",
        durationSeconds = 10.0,
        fileSizeBytes = 100,
        sha256 = "hash-$creativeId",
        position = position,
        manifestVersion = "v1",
        downloadStatus = PlaylistItemEntity.STATUS_READY,
        localPath = "/nonexistent/$creativeId.mp4",
        lastError = null,
        updatedAt = 0,
    )

    private fun healthyImageItem(creativeId: String, position: Int, durationSeconds: Double = 5.0) = PlaylistItemEntity(
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
    fun `a single-item grade that fails enters Fallback instead of giving up permanently`() = runBlocking {
        db.playlistItemDao().upsertAll(listOf(brokenVideoItem("only1", position = 1)))

        withTimeout(5_000) {
            while (viewModel.uiState.value !is PlayerUiState.Fallback) {
                idleMain(25)
                delay(25)
            }
        }

        val fallback = viewModel.uiState.value as PlayerUiState.Fallback
        assertEquals("all_items_failed", fallback.reason)
    }

    @Test
    fun `the recovery loop resumes automatically once a new item becomes available, with no external nudge`() = runBlocking {
        db.playlistItemDao().upsertAll(listOf(brokenVideoItem("only1", position = 1)))

        withTimeout(5_000) {
            while (viewModel.uiState.value !is PlayerUiState.Fallback) {
                idleMain(25)
                delay(25)
            }
        }

        // Simulates a fresh manifest sync bringing genuinely new content —
        // exactly what a background WorkManager sync does in production,
        // atomic swap and all (MediaDownloadManager.sync() always removes
        // whatever's no longer in the incoming manifest). Nothing here
        // ever calls into the ViewModel directly: recovery must notice
        // this purely by polling Room on its own timer.
        db.playlistItemDao().upsertAll(listOf(healthyImageItem("fresh1", position = 1)))
        db.playlistItemDao().deleteNotIn(listOf("fresh1"))

        withTimeout(5_000) {
            while (viewModel.uiState.value !is PlayerUiState.Playing) {
                idleMain(25)
                delay(25)
            }
        }

        val playing = viewModel.uiState.value as PlayerUiState.Playing
        assertEquals("fresh1", playing.item.creativeId)
    }

    @Test
    fun `recovery also fires when every item in a multi-item grade has failed at least once`() = runBlocking {
        // The exact TESTE01 incident shape: two items, each failed once,
        // consecutiveFailures (2) >= queue.size (2) trips the give-up
        // branch even though neither individually reached the 2-failure
        // per-creative quarantine threshold.
        db.playlistItemDao().upsertAll(
            listOf(brokenVideoItem("bad1", position = 1), brokenVideoItem("bad2", position = 2)),
        )

        withTimeout(5_000) {
            while (viewModel.uiState.value !is PlayerUiState.Fallback) {
                idleMain(25)
                delay(25)
            }
        }

        assertTrue(
            (db.mediaQuarantineDao().get("bad1")?.consecutiveFailures ?: 0) < 2 ||
                (db.mediaQuarantineDao().get("bad2")?.consecutiveFailures ?: 0) < 2,
        )

        db.playlistItemDao().upsertAll(listOf(healthyImageItem("fresh1", position = 1)))
        db.playlistItemDao().deleteNotIn(listOf("fresh1"))
        withTimeout(5_000) {
            while (viewModel.uiState.value !is PlayerUiState.Playing) {
                idleMain(25)
                delay(25)
            }
        }
    }
}
