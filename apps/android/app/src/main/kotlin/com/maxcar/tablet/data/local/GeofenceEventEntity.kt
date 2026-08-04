package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One geofence state-machine transition (enter/exit/dwell) awaiting sync to
 * `/device-geofence-events`. Mirrors [PlaybackEventEntity]'s shape and
 * lifecycle exactly: written once by [com.maxcar.tablet.geo.GeoEngine] the
 * moment a transition happens, deleted locally only once the server has
 * confirmed it — never a live stream of raw location fixes, just the
 * transitions the hysteresis state machine actually decided on.
 */
@Entity(tableName = "geofence_events")
data class GeofenceEventEntity(
    @PrimaryKey val clientEventId: String,
    val geofenceId: String,
    val eventType: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float?,
    val distanceMeters: Double?,
    val occurredAt: String,
    val createdAt: Long,
    val attemptCount: Int = 0,
) {
    companion object {
        const val TYPE_ENTER = "enter"
        const val TYPE_EXIT = "exit"
        const val TYPE_DWELL = "dwell"
    }
}
