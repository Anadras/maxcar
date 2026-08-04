package com.maxcar.tablet.geo

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.DeviceIdentityProvider
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Never used by these tests — [GeoEngine] only reads
 * [GeoRulesSyncManager.readyRules] (a pass-through over Room), it never
 * calls [GeoRulesSyncManager.sync] here. */
private class UnusedDeviceIdentityProvider : DeviceIdentityProvider {
    override suspend fun currentKeyId(): String? = null
    override suspend fun handleUnauthorizedDeviceKey() = Unit
}

/**
 * Runs on real dispatchers/real threads deliberately, not
 * kotlinx-coroutines-test's virtual time: [GeoEngine]'s rules collector
 * consumes a Room-backed [kotlinx.coroutines.flow.Flow], whose actual query
 * runs on Room's own executor regardless of which dispatcher collects it —
 * a virtual scheduler's `advanceUntilIdle()` has no way to know when that
 * real background work finishes. A short, bounded real wait
 * ([awaitRuleSync]) is simpler and more honest here than fighting that
 * mismatch.
 */
@RunWith(RobolectricTestRunner::class)
class GeoEngineTest {

    private lateinit var db: AppDatabase
    private lateinit var geoEngine: GeoEngine

    private fun rule(
        geofenceId: String,
        latitude: Double,
        longitude: Double,
        radiusMeters: Int = 150,
        cooldownSeconds: Int = 600,
        lastTriggeredAtMillis: Long? = null,
    ) = GeoRuleEntity(
        geofenceId = geofenceId,
        campaignId = "campaign-$geofenceId",
        creativeId = "creative-$geofenceId",
        establishmentId = "establishment-$geofenceId",
        latitude = latitude,
        longitude = longitude,
        radiusMeters = radiusMeters,
        priority = 50,
        cooldownSeconds = cooldownSeconds,
        type = "image",
        mimeType = "image/jpeg",
        durationSeconds = 10.0,
        fileSizeBytes = 1000,
        sha256 = "hash",
        rulesVersion = "v1",
        downloadStatus = GeoRuleEntity.STATUS_READY,
        localPath = "/tmp/$geofenceId.jpg",
        lastError = null,
        lastTriggeredAtMillis = lastTriggeredAtMillis,
        updatedAt = 0,
    )

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val geoRulesSyncManager = GeoRulesSyncManager(
            context = context,
            apiClient = DeviceApiClient(baseUrl = "http://localhost/"),
            deviceIdentity = UnusedDeviceIdentityProvider(),
            geoRuleDao = db.geoRuleDao(),
        )
        geoEngine = GeoEngine(
            locationEngine = LocationEngine(context),
            geoRulesSyncManager = geoRulesSyncManager,
            geoRuleDao = db.geoRuleDao(),
            geofenceEventDao = db.geofenceEventDao(),
            scope = CoroutineScope(Dispatchers.IO),
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** Waits (real time, bounded) until the engine's rules collector has
     * caught up to what's in Room — deterministic without coupling the
     * test to GeoEngine's internal collector implementation. */
    private suspend fun awaitRuleSync(expectedCount: Int) {
        withTimeout(5_000) {
            while (geoEngine.status.value.readyRuleCount != expectedCount) {
                geoEngine.simulateLocation(0.0, 0.0) // re-triggers a status recompute
                delay(50)
            }
        }
    }

    @Test
    fun `with no synced rules, the diagnostic clearly reports zero — a sync problem, not a location one`() = runBlocking {
        geoEngine.start() // engages the rules collector; permission is denied under Robolectric, which simulateLocation doesn't need.
        geoEngine.simulateLocation(-20.4489, -54.6167)

        val status = geoEngine.status.value
        assertEquals(0, status.readyRuleCount)
        assertNull(status.nearestRule)
    }

    @Test
    fun `the nearest rule diagnostic reports distance, radius and inside-outside correctly`() = runBlocking {
        db.geoRuleDao().upsertAll(
            listOf(
                rule("far", latitude = -20.50, longitude = -54.60, radiusMeters = 150),
                rule("near", latitude = -20.4489, longitude = -54.6167, radiusMeters = 150),
            ),
        )
        geoEngine.start()
        awaitRuleSync(expectedCount = 2)

        // Vehicle is essentially at the "near" establishment.
        geoEngine.simulateLocation(-20.4489, -54.6167)

        val status = geoEngine.status.value
        assertEquals(2, status.readyRuleCount)
        val nearest = requireNotNull(status.nearestRule)
        assertEquals("near", nearest.geofenceId)
        assertTrue("expected the vehicle to be reported inside the near geofence", nearest.isInside)
        assertTrue(nearest.distanceMeters < 150)
    }

    @Test
    fun `a rule still in cooldown reports the remaining seconds instead of zero`() = runBlocking {
        val now = System.currentTimeMillis()
        db.geoRuleDao().upsertAll(
            listOf(
                rule(
                    "cooling-down",
                    latitude = -20.4489,
                    longitude = -54.6167,
                    cooldownSeconds = 600,
                    lastTriggeredAtMillis = now - 100_000, // triggered 100s ago
                ),
            ),
        )
        geoEngine.start()
        awaitRuleSync(expectedCount = 1)

        geoEngine.simulateLocation(-20.4489, -54.6167)

        val nearest = requireNotNull(geoEngine.status.value.nearestRule)
        // 600s cooldown - 100s elapsed = ~500s remaining.
        assertTrue(
            "expected remaining cooldown near 500s, was ${nearest.cooldownRemainingSeconds}",
            nearest.cooldownRemainingSeconds in 480..500,
        )
    }
}
