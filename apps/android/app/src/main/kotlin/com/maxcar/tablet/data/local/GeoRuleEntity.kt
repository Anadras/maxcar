package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One row per GEO geofence rule, doubling as its own download/cache state —
 * the exact same shape as [PlaylistItemEntity], since a GEO creative
 * downloads through the identical pipeline as a REGULAR one (MAX-008 item
 * 24: no separate GEO streaming). Keyed by [geofenceId] (the server's
 * `campaign_geofences.id`), not campaignId, because one campaign can have
 * several geofences at different establishments.
 *
 * [lastTriggeredAtMillis] is the cooldown state itself: written the moment
 * this rule's creative actually starts playing, read by
 * [com.maxcar.tablet.geo.GeoEngine] before ever proposing the same rule
 * again. Persisting it in Room (not just in memory) is what makes cooldown
 * survive an app restart or reboot, per MAX-008 item 15.
 */
@Entity(tableName = "geo_rules")
data class GeoRuleEntity(
    @PrimaryKey val geofenceId: String,
    val campaignId: String,
    val creativeId: String,
    val establishmentId: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Int,
    val priority: Int,
    val cooldownSeconds: Int,
    // MAX-011: when this campaign should take over from whatever's
    // currently playing on entering its geofence — see
    // com.maxcar.tablet.geo.GeoPlaybackMode. Stored as the server's raw
    // string so an app build older than a future new mode still falls back
    // safely (GeoPlaybackMode.from parses unknown values as AFTER_CURRENT,
    // today's existing behavior) instead of crashing on deserialization.
    val playbackMode: String = "AFTER_CURRENT",
    val maxWaitSeconds: Int = 5,
    val type: String,
    val mimeType: String,
    val durationSeconds: Double,
    val fileSizeBytes: Long?,
    val sha256: String?,
    val rulesVersion: String,
    val downloadStatus: String,
    val localPath: String?,
    val lastError: String?,
    val lastTriggeredAtMillis: Long?,
    val updatedAt: Long,
) {
    companion object {
        const val STATUS_PENDING = "PENDING"
        const val STATUS_DOWNLOADING = "DOWNLOADING"
        const val STATUS_READY = "READY"
        const val STATUS_FAILED = "FAILED"
    }
}
