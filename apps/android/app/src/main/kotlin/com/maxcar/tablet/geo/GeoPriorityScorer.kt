package com.maxcar.tablet.geo

import com.maxcar.tablet.data.local.GeoRuleEntity

/** One geofence the vehicle is currently and eligibly inside: cooldown
 * already checked, validity already checked — this is purely "which of the
 * currently-valid options wins". */
data class GeoCandidate(
    val rule: GeoRuleEntity,
    val distanceMeters: Double,
    val enteredAtMillis: Long,
)

/**
 * Deterministic overlap resolution (MAX-008 item 13): when two or more
 * geofences the vehicle is inside are simultaneously eligible, exactly one
 * fixed comparator chain decides which plays — never randomness, never
 * insertion order.
 *
 * Formula, in order (each level only breaks ties left by the one above):
 * 1. Highest `priority` (server-set, geofence override wins over the
 *    campaign default — see get_device_geo_rules).
 * 2. Shortest `distanceMeters` (closer establishment wins).
 * 3. Earliest `enteredAtMillis` (first geofence the vehicle actually
 *    entered wins over one entered a moment later).
 * 4. `geofenceId` lexicographic order — a final, arbitrary-but-stable
 *    tiebreaker so the result is reproducible even if every field above
 *    ties exactly (never left to hash-map iteration order or chance).
 */
object GeoPriorityScorer {
    fun selectBestCandidate(candidates: List<GeoCandidate>): GeoCandidate? =
        candidates.sortedWith(
            compareByDescending<GeoCandidate> { it.rule.priority }
                .thenBy { it.distanceMeters }
                .thenBy { it.enteredAtMillis }
                .thenBy { it.rule.geofenceId },
        ).firstOrNull()
}
