package com.maxcar.tablet.geo

import com.maxcar.tablet.data.local.GeoRuleEntity
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Real geographic great-circle distance (haversine), not a pixel/map
 * approximation (MAX-008 item 6). Accurate to well under 1% at the
 * pilot's scale (geofence radii in the tens-to-hundreds of meters), and
 * pure math — no Android framework dependency — so the whole state
 * machine below is plain-JUnit testable without Robolectric.
 */
object GeoDistance {
    private const val EARTH_RADIUS_METERS = 6_371_000.0

    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return EARTH_RADIUS_METERS * c
    }
}

enum class GeofenceState { OUTSIDE, INSIDE }

data class GeofenceTransition(
    val geofenceId: String,
    val type: String,
    val distanceMeters: Double,
    val occurredAtMillis: Long,
)

/**
 * Per-geofence hysteresis (MAX-008 items 9-10): entry fires at
 * distance <= radius; exit only fires at distance >= radius +
 * [exitMarginMeters], never at the same threshold as entry. A vehicle
 * parked right at the radius boundary can't flicker enter/exit/enter on
 * GPS jitter, and a continuously-inside vehicle never re-fires ENTER on
 * every location tick — only the OUTSIDE->INSIDE and INSIDE->OUTSIDE edges
 * ever produce a [GeofenceTransition].
 */
class GeofenceStateMachine(private val exitMarginMeters: Double = DEFAULT_EXIT_MARGIN_METERS) {
    private val states = mutableMapOf<String, GeofenceState>()

    fun evaluate(
        rules: List<GeoRuleEntity>,
        location: LocationSample,
        nowMillis: Long,
    ): List<GeofenceTransition> {
        val transitions = mutableListOf<GeofenceTransition>()
        for (rule in rules) {
            val distance = distanceTo(rule, location)
            val current = states[rule.geofenceId] ?: GeofenceState.OUTSIDE
            val next = when (current) {
                GeofenceState.OUTSIDE ->
                    if (distance <= rule.radiusMeters) GeofenceState.INSIDE else GeofenceState.OUTSIDE
                GeofenceState.INSIDE ->
                    if (distance >= rule.radiusMeters + exitMarginMeters) GeofenceState.OUTSIDE else GeofenceState.INSIDE
            }
            if (next != current) {
                states[rule.geofenceId] = next
                transitions += GeofenceTransition(
                    geofenceId = rule.geofenceId,
                    type = if (next == GeofenceState.INSIDE) TYPE_ENTER else TYPE_EXIT,
                    distanceMeters = distance,
                    occurredAtMillis = nowMillis,
                )
            }
        }
        // Forgets state for any geofence no longer in the current rule set
        // (deactivated or expired server-side) rather than leaking it
        // forever in memory.
        states.keys.retainAll(rules.map { it.geofenceId }.toSet())
        return transitions
    }

    fun isInside(geofenceId: String): Boolean = states[geofenceId] == GeofenceState.INSIDE

    fun distanceTo(rule: GeoRuleEntity, location: LocationSample): Double =
        GeoDistance.haversineMeters(location.latitude, location.longitude, rule.latitude, rule.longitude)

    companion object {
        const val DEFAULT_EXIT_MARGIN_METERS = 15.0
        const val TYPE_ENTER = "enter"
        const val TYPE_EXIT = "exit"
    }
}
