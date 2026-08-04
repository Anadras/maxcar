package com.maxcar.tablet.geo

import com.maxcar.tablet.data.local.GeoRuleEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private fun rule(geofenceId: String, priority: Int) = GeoRuleEntity(
    geofenceId = geofenceId,
    campaignId = "campaign-$geofenceId",
    creativeId = "creative-$geofenceId",
    establishmentId = "establishment-$geofenceId",
    latitude = 0.0,
    longitude = 0.0,
    radiusMeters = 150,
    priority = priority,
    cooldownSeconds = 600,
    type = "image",
    mimeType = "image/jpeg",
    durationSeconds = 10.0,
    fileSizeBytes = 1000,
    sha256 = "hash",
    rulesVersion = "v1",
    downloadStatus = GeoRuleEntity.STATUS_READY,
    localPath = "/tmp/$geofenceId.jpg",
    lastError = null,
    lastTriggeredAtMillis = null,
    updatedAt = 0,
)

class GeoPriorityScorerTest {

    @Test
    fun `no candidates means no selection`() {
        assertNull(GeoPriorityScorer.selectBestCandidate(emptyList()))
    }

    @Test
    fun `highest priority wins regardless of distance`() {
        val candidates = listOf(
            GeoCandidate(rule("low-priority-close", priority = 10), distanceMeters = 5.0, enteredAtMillis = 1000),
            GeoCandidate(rule("high-priority-far", priority = 90), distanceMeters = 140.0, enteredAtMillis = 1000),
        )
        val best = GeoPriorityScorer.selectBestCandidate(candidates)
        assertEquals("high-priority-far", best?.rule?.geofenceId)
    }

    @Test
    fun `equal priority breaks the tie by shortest distance`() {
        val candidates = listOf(
            GeoCandidate(rule("far", priority = 50), distanceMeters = 100.0, enteredAtMillis = 1000),
            GeoCandidate(rule("near", priority = 50), distanceMeters = 20.0, enteredAtMillis = 1000),
        )
        val best = GeoPriorityScorer.selectBestCandidate(candidates)
        assertEquals("near", best?.rule?.geofenceId)
    }

    @Test
    fun `equal priority and distance breaks the tie by earliest entry time`() {
        val candidates = listOf(
            GeoCandidate(rule("entered-later", priority = 50), distanceMeters = 50.0, enteredAtMillis = 5000),
            GeoCandidate(rule("entered-first", priority = 50), distanceMeters = 50.0, enteredAtMillis = 1000),
        )
        val best = GeoPriorityScorer.selectBestCandidate(candidates)
        assertEquals("entered-first", best?.rule?.geofenceId)
    }

    @Test
    fun `a total tie is still resolved deterministically by geofenceId, never randomly`() {
        val candidates = listOf(
            GeoCandidate(rule("z-geofence", priority = 50), distanceMeters = 50.0, enteredAtMillis = 1000),
            GeoCandidate(rule("a-geofence", priority = 50), distanceMeters = 50.0, enteredAtMillis = 1000),
        )
        // Run the selection several times: with a real random tiebreak this
        // would occasionally flip; a deterministic one never does.
        repeat(5) {
            val best = GeoPriorityScorer.selectBestCandidate(candidates)
            assertEquals("a-geofence", best?.rule?.geofenceId)
        }
    }
}
