package com.maxcar.tablet.ui.player

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeDeviceKeyStore
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import android.os.Looper
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
 * MAX-011: covers the three GEO playback modes' actual effect on what the
 * player is showing — IMMEDIATE/MAX_WAIT are the only two paths capable of
 * cutting a currently-playing REGULAR item short (see
 * PlayerViewModel.onGeoCandidateAvailable); AFTER_CURRENT deliberately
 * leaves the pre-existing item-boundary behavior untouched.
 *
 * Runs on real dispatchers/real time deliberately, same rationale as
 * GeoEngineTest: GeoEngine's rules collector consumes a real Room flow,
 * which virtual time can't fast-forward through.
 */
@RunWith(RobolectricTestRunner::class)
class PlayerViewModelGeoInterruptionTest {

    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var deviceRepository: DeviceRepository
    private lateinit var mediaDownloadManager: MediaDownloadManager
    private lateinit var geoEngine: GeoEngine
    private lateinit var viewModel: PlayerViewModel

    private val regularCampaignId = "regular-campaign"
    private val geoCampaignId = "geo-campaign"

    @Before
    fun setUp() {
        // Deliberately does NOT override Dispatchers.Main: ExoPlayer (owned
        // by PlayerViewModel) enforces that every call reaches it from the
        // exact Looper it was built on, and ExoPlayer.Builder falls back to
        // Looper.getMainLooper() when built from a thread with no Looper of
        // its own — so any stand-in Main dispatcher not actually backed by
        // Robolectric's real main Looper (e.g. Dispatchers.Unconfined,
        // which can resume a coroutine after delay() on an unrelated
        // background thread) makes a real exoPlayer.stop() call from a
        // MAX_WAIT timer intermittently violate that check. Leaving Main at
        // its real Robolectric-backed default and periodically draining it
        // (see awaitShowing/simulateLocationUntilCandidateReady) keeps
        // every ExoPlayer touch on the one correct thread.
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        appPreferences = AppPreferences(
            PreferenceDataStoreFactory.create(
                scope = CoroutineScope(Dispatchers.Unconfined),
            ) { prefsFile },
        )

        val apiClient = DeviceApiClient(
            baseUrl = "http://localhost/",
            deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() },
        )

        deviceRepository = DeviceRepository(
            apiClient = apiClient,
            deviceKeyStore = FakeDeviceKeyStore().apply { getOrCreateKeyInfo() },
            installationIdStore = com.maxcar.tablet.data.local.InstallationIdStore(
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

    /** Robolectric's main Looper defaults to paused *and* runs on its own
     * fake clock that doesn't advance on its own just because real
     * wall-clock time passes — a `postDelayed`/coroutine `delay()` task
     * scheduled on Main (the GEO candidate collector, the MAX_WAIT timer)
     * only ever runs once this is told to move that fake clock forward by
     * roughly the same amount as the real delay it's interleaved with
     * below, and to drain whatever became due in the process. */
    private fun idleMain(millis: Long = 0) {
        if (millis > 0) {
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(millis))
        } else {
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    private suspend fun seedRegularItem(durationSeconds: Double = 300.0) {
        db.playlistItemDao().upsertAll(
            listOf(
                PlaylistItemEntity(
                    creativeId = "regular-creative",
                    campaignId = regularCampaignId,
                    type = "image",
                    mimeType = "image/jpeg",
                    durationSeconds = durationSeconds,
                    fileSizeBytes = 100,
                    sha256 = "hash",
                    position = 0,
                    manifestVersion = "v1",
                    downloadStatus = PlaylistItemEntity.STATUS_READY,
                    localPath = "/tmp/regular.jpg",
                    lastError = null,
                    updatedAt = 0,
                ),
            ),
        )
    }

    private fun geoRule(
        playbackMode: String,
        maxWaitSeconds: Int = 5,
        geofenceId: String = "geofence-1",
        campaignId: String = geoCampaignId,
        creativeId: String = "geo-creative",
        priority: Int = 50,
    ) = GeoRuleEntity(
        geofenceId = geofenceId,
        campaignId = campaignId,
        creativeId = creativeId,
        establishmentId = "establishment-1",
        latitude = -20.4489,
        longitude = -54.6167,
        radiusMeters = 150,
        priority = priority,
        cooldownSeconds = 600,
        playbackMode = playbackMode,
        maxWaitSeconds = maxWaitSeconds,
        type = "image",
        mimeType = "image/jpeg",
        durationSeconds = 8.0,
        fileSizeBytes = 100,
        sha256 = "hash-$creativeId",
        rulesVersion = "v1",
        downloadStatus = GeoRuleEntity.STATUS_READY,
        localPath = "/tmp/$creativeId.jpg",
        lastError = null,
        lastTriggeredAtMillis = null,
        updatedAt = 0,
    )

    /** Bounded, real-time wait for the player to be showing a given
     * campaign — avoids coupling the test to any particular collector
     * implementation detail. */
    private suspend fun awaitShowing(campaignId: String, timeoutMs: Long = 5_000) {
        withTimeout(timeoutMs) {
            while ((viewModel.uiState.value as? PlayerUiState.Playing)?.item?.campaignId != campaignId) {
                idleMain(25)
                delay(25)
            }
        }
    }

    /** [GeoEngine]'s rules collector consumes a real Room-backed Flow on a
     * background dispatcher (same caveat GeoEngineTest documents) — a
     * single [GeoEngine.simulateLocation] call right after seeding a rule
     * can race ahead of that collector and evaluate against an empty rule
     * set. Re-simulating until the engine reports the rule as ready is
     * what GeoEngineTest calls `awaitRuleSync`; this does the same thing
     * inline since the actual assertion here is about the *player*, not
     * the engine's own diagnostics. */
    private suspend fun simulateLocationUntilCandidateReady(
        latitude: Double,
        longitude: Double,
        timeoutMs: Long = 5_000,
    ) {
        withTimeout(timeoutMs) {
            while (geoEngine.nextCandidate.value == null && geoEngine.status.value.readyRuleCount == 0) {
                geoEngine.simulateLocation(latitude, longitude)
                idleMain(50)
                delay(50)
            }
            geoEngine.simulateLocation(latitude, longitude)
            idleMain()
        }
    }

    @Test
    fun `IMMEDIATE interrupts the currently playing REGULAR item within a couple seconds`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(listOf(geoRule(playbackMode = "IMMEDIATE")))
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167) // inside the geofence immediately

        awaitShowing(geoCampaignId, timeoutMs = 5_000)

        val interrupted = db.playbackEventDao().oldest(10).filter { it.status == "interrupted" }
        assertEquals(1, interrupted.size)
        assertEquals(regularCampaignId, interrupted.single().campaignId)
    }

    @Test
    fun `AFTER_CURRENT never interrupts — the REGULAR item keeps playing`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(listOf(geoRule(playbackMode = "AFTER_CURRENT")))
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167)

        // Give the (wrong) interruption path every chance to fire, then
        // assert it didn't.
        repeat(15) {
            idleMain(100)
            delay(100)
        }
        assertEquals(
            regularCampaignId,
            (viewModel.uiState.value as PlayerUiState.Playing).item.campaignId,
        )
        assertTrue(db.playbackEventDao().oldest(10).none { it.status == "interrupted" })
    }

    @Test
    fun `MAX_WAIT lets the item keep playing until the configured wait, then interrupts`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(listOf(geoRule(playbackMode = "MAX_WAIT", maxWaitSeconds = 1)))
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167)

        // Still the REGULAR item well before the 1s wait elapses.
        idleMain(200)
        delay(200)
        assertEquals(
            regularCampaignId,
            (viewModel.uiState.value as PlayerUiState.Playing).item.campaignId,
        )

        awaitShowing(geoCampaignId, timeoutMs = 5_000)
    }

    @Test
    fun `a second candidate never double-splices while a GEO item is already playing`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(listOf(geoRule(playbackMode = "IMMEDIATE")))
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167)
        awaitShowing(geoCampaignId, timeoutMs = 5_000)

        // Location keeps updating (as it would in the real world) while the
        // GEO creative is still showing — must not re-trigger.
        repeat(5) {
            geoEngine.simulateLocation(-20.4489, -54.6167)
            idleMain(50)
            delay(50)
        }

        val interrupted = db.playbackEventDao().oldest(10).filter { it.status == "interrupted" }
        assertEquals(1, interrupted.size)
    }

    @Test
    fun `a strictly higher priority GEO candidate interrupts a currently playing lower priority one`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(
            listOf(
                geoRule(
                    playbackMode = "IMMEDIATE", geofenceId = "geofence-low",
                    campaignId = "geo-low", creativeId = "geo-creative-low", priority = 10,
                ),
            ),
        )
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167)
        awaitShowing("geo-low", timeoutMs = 5_000)

        // A second, higher-priority geofence becomes eligible at the same
        // spot while the low-priority GEO item is still showing.
        db.geoRuleDao().upsertAll(
            listOf(
                geoRule(
                    playbackMode = "IMMEDIATE", geofenceId = "geofence-high",
                    campaignId = "geo-high", creativeId = "geo-creative-high", priority = 90,
                ),
            ),
        )
        withTimeout(5_000) {
            while (geoEngine.nextCandidate.value?.geofenceId != "geofence-high") {
                geoEngine.simulateLocation(-20.4489, -54.6167)
                idleMain(50)
                delay(50)
            }
        }

        awaitShowing("geo-high", timeoutMs = 5_000)
        val interrupted = db.playbackEventDao().oldest(10).filter { it.status == "interrupted" }
        assertEquals(2, interrupted.size) // the REGULAR item, then geo-low
        assertTrue(interrupted.any { it.campaignId == "geo-low" })
    }

    @Test
    fun `an equal-priority GEO candidate never interrupts what's already playing`() = runBlocking {
        seedRegularItem()
        awaitShowing(regularCampaignId)

        db.geoRuleDao().upsertAll(
            listOf(
                geoRule(
                    playbackMode = "IMMEDIATE", geofenceId = "geofence-a",
                    campaignId = "geo-a", creativeId = "geo-creative-a", priority = 50,
                ),
            ),
        )
        geoEngine.start()
        simulateLocationUntilCandidateReady(-20.4489, -54.6167)
        awaitShowing("geo-a", timeoutMs = 5_000)

        db.geoRuleDao().upsertAll(
            listOf(
                geoRule(
                    playbackMode = "IMMEDIATE", geofenceId = "geofence-b",
                    campaignId = "geo-b", creativeId = "geo-creative-b", priority = 50,
                ),
            ),
        )
        repeat(15) {
            geoEngine.simulateLocation(-20.4489, -54.6167)
            idleMain(100)
            delay(100)
        }

        assertEquals("geo-a", (viewModel.uiState.value as PlayerUiState.Playing).item.campaignId)
        assertTrue(db.playbackEventDao().oldest(10).none { it.campaignId == "geo-a" && it.status == "interrupted" })
    }
}
