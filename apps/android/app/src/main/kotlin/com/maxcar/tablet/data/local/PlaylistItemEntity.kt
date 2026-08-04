package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.time.Instant

/**
 * One row per manifest playlist entry, doubling as its own download/cache
 * state. The manifest is already a flat, position-ordered array (see
 * [com.maxcar.tablet.data.remote.DeviceApiClient.getManifest]), so a single
 * entity mirrors it directly instead of normalizing into separate
 * campaign/creative/playlist-item/download tables the app has no other use
 * for. Keyed by [creativeId]: an active manifest can't repeat a creative,
 * and keying on it is what makes re-syncing the same manifest a plain
 * upsert rather than a diff the app has to compute itself.
 *
 * The signed download URL is deliberately not a column here: it's a
 * short-lived credential, used once by the download worker right after a
 * manifest fetch, never a value worth persisting.
 */
@Entity(tableName = "playlist_items")
data class PlaylistItemEntity(
    @PrimaryKey val creativeId: String,
    val campaignId: String,
    val type: String,
    val mimeType: String,
    val durationSeconds: Double,
    val fileSizeBytes: Long?,
    val sha256: String?,
    val position: Int,
    val manifestVersion: String,
    val downloadStatus: String,
    val localPath: String?,
    val lastError: String?,
    val updatedAt: Long,
    // Persisted so the player can stop showing an expired campaign purely
    // from the local clock, even fully offline (MAX-009 item 46) — the
    // server already filters these at manifest-generation time, but a
    // tablet that's been offline since before an item expired would
    // otherwise keep looping it forever.
    val startsAt: String? = null,
    val endsAt: String? = null,
) {
    /** True when [nowMillis] falls inside [startsAt, endsAt] (either bound
     * missing means unbounded on that side) — mirrors the server-side
     * `c.starts_at <= now() and c.ends_at >= now()` filter in
     * `get_device_manifest`, evaluated locally instead. */
    fun isCurrentlyValid(nowMillis: Long): Boolean {
        val startOk = startsAt?.let { runCatching { Instant.parse(it).toEpochMilli() <= nowMillis }.getOrDefault(true) } ?: true
        val endOk = endsAt?.let { runCatching { Instant.parse(it).toEpochMilli() >= nowMillis }.getOrDefault(true) } ?: true
        return startOk && endOk
    }

    companion object {
        const val STATUS_PENDING = "PENDING"
        const val STATUS_DOWNLOADING = "DOWNLOADING"
        const val STATUS_READY = "READY"
        const val STATUS_FAILED = "FAILED"
        const val STATUS_OBSOLETE = "OBSOLETE"
    }
}
