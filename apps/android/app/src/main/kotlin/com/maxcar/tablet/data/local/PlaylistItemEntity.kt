package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

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
) {
    companion object {
        const val STATUS_PENDING = "PENDING"
        const val STATUS_DOWNLOADING = "DOWNLOADING"
        const val STATUS_READY = "READY"
        const val STATUS_FAILED = "FAILED"
        const val STATUS_OBSOLETE = "OBSOLETE"
    }
}
