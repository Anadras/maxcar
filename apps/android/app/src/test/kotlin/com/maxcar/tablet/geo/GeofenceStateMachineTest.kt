package com.maxcar.tablet.geo

import com.maxcar.tablet.data.local.GeoRuleEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private const val ESTABLISHMENT_LAT = -20.4489
private const val ESTABLISHMENT_LON = -54.6167

private fun rule(
    geofenceId: String = "geo-1",
    radiusMeters: Int = 150,
    priority: Int = 50,
    cooldownSeconds: Int = 600,
    lastTriggeredAtMillis: Long? = null,
) = GeoRuleEntity(
    geofenceId = geofenceId,
    campaignId = "campaign-1",
    creativeId = "creative-1",
    establishmentId = "establishment-1",
    latitude = ESTABLISHMENT_LAT,
    longitude = ESTABLISHMENT_LON,
    radiusMeters = radiusMeters,
    priority = priority,
    cooldownSeconds = cooldownSeconds,
    type = "image",
    mimeType = "image/jpeg",
    durationSeconds = 10.0,
    fileSizeBytes = 1000,
    sha256 = "hash",
    rulesVersion = "v1",
    downloadStatus = GeoRuleEntity.STATUS_READY,
    localPath = "/tmp/geo-1.jpg",
    lastError = null,
    lastTriggeredAtMillis = lastTriggeredAtMillis,
    updatedAt = 0,
)

private fun locationAt(latitude: Double, longitude: Double) = LocationSample(
    latitude = latitude,
    longitude = longitude,
    accuracyMeters = 5f,
    speedMetersPerSecond = 0f,
    bearingDegrees = 0f,
    timestampMillis = 0,
)

class GeofenceStateMachineTest {

    @Test
    fun `haversine distance is zero at the exact same point`() {
        val distance = GeoDistance.haversineMeters(ESTABLISHMENT_LAT, ESTABLISHMENT_LON, ESTABLISHMENT_LAT, ESTABLISHMENT_LON)
        assertEquals(0.0, distance, 0.01)
    }

    @Test
    fun `haversine distance roughly matches a known 1 degree latitude separation`() {
        // ~111.19 km per degree of latitude at the equator-ish scale used
        // here; a real geographic formula, not a flat pixel approximation.
        val distance = GeoDistance.haversineMeters(0.0, 0.0, 1.0, 0.0)
        assertTrue(distance in 110_000.0..112_000.0)
    }

    @Test
    fun `entering the radius fires exactly one ENTER transition`() {
        val machine = GeofenceStateMachine()
        val geofence = rule(radiusMeters = 150)
        val farAway = locationAt(ESTABLISHMENT_LAT + 1.0, ESTABLISHMENT_LON)
        val inside = locationAt(ESTABLISHMENT_LAT, ESTABLISHMENT_LON)

        val outsideTransitions = machine.evaluate(listOf(geofence), farAway, 1000)
        assertTrue(outsideTransitions.isEmpty())

        val enterTransitions = machine.evaluate(listOf(geofence), inside, 2000)
        assertEquals(1, enterTransitions.size)
        assertEquals("enter", enterTransitions[0].type)
        assertTrue(machine.isInside(geofence.geofenceId))
    }

    @Test
    fun `staying inside never re-fires ENTER on repeated ticks`() {
        val machine = GeofenceStateMachine()
        val geofence = rule(radiusMeters = 150)
        val inside = locationAt(ESTABLISHMENT_LAT, ESTABLISHMENT_LON)

        machine.evaluate(listOf(geofence), inside, 1000)
        val secondTick = machine.evaluate(listOf(geofence), inside, 2000)
        val thirdTick = machine.evaluate(listOf(geofence), inside, 3000)

        assertTrue(secondTick.isEmpty())
        assertTrue(thirdTick.isEmpty())
    }

    @Test
    fun `exit only fires once distance clears radius plus the hysteresis margin`() {
        val machine = GeofenceStateMachine(exitMarginMeters = 15.0)
        val geofence = rule(radiusMeters = 150)
        machine.evaluate(listOf(geofence), locationAt(ESTABLISHMENT_LAT, ESTABLISHMENT_LON), 1000)
        assertTrue(machine.isInside(geofence.geofenceId))

        // ~160m away (within radius + margin = 165m): must NOT exit yet —
        // this is exactly the hysteresis band that prevents flicker at the
        // boundary.
        val justOutsideRadiusButInsideMargin = locationAt(ESTABLISHMENT_LAT + 0.00144, ESTABLISHMENT_LON)
        val distance = machine.distanceTo(geofence, justOutsideRadiusButInsideMargin)
        assertTrue("expected distance inside the hysteresis band, was $distance", distance in 150.0..165.0)
        val noExitYet = machine.evaluate(listOf(geofence), justOutsideRadiusButInsideMargin, 2000)
        assertTrue(noExitYet.isEmpty())
        assertTrue(machine.isInside(geofence.geofenceId))

        // Clearly past radius + margin: now it must exit.
        val wellOutside = locationAt(ESTABLISHMENT_LAT + 0.01, ESTABLISHMENT_LON)
        val exitTransitions = machine.evaluate(listOf(geofence), wellOutside, 3000)
        assertEquals(1, exitTransitions.size)
        assertEquals("exit", exitTransitions[0].type)
        assertTrue(!machine.isInside(geofence.geofenceId))
    }

    @Test
    fun `a geofence removed from the rule set stops being tracked`() {
        val machine = GeofenceStateMachine()
        val geofence = rule(radiusMeters = 150)
        machine.evaluate(listOf(geofence), locationAt(ESTABLISHMENT_LAT, ESTABLISHMENT_LON), 1000)
        assertTrue(machine.isInside(geofence.geofenceId))

        machine.evaluate(emptyList(), locationAt(ESTABLISHMENT_LAT, ESTABLISHMENT_LON), 2000)
        assertTrue(!machine.isInside(geofence.geofenceId))
    }
}
