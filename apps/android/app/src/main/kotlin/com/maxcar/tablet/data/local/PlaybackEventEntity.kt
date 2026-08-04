package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One finalized playback attempt awaiting sync to `/device-playback-events`.
 * Written only once playback has actually ended — successfully, by error,
 * or left incomplete by an app/device restart — never while still playing:
 * the server side is a single idempotent insert per event, not a live
 * start/stop pair, so there is nothing to update in place once a row
 * exists locally.
 */
@Entity(tableName = "playback_events")
data class PlaybackEventEntity(
    @PrimaryKey val clientEventId: String,
    val campaignId: String,
    val creativeId: String?,
    val status: String,
    val startedAt: String,
    val completedAt: String?,
    val durationMs: Long?,
    val completionPercentage: Int?,
    val failureReason: String?,
    val offline: Boolean,
    val createdAt: Long,
    val attemptCount: Int = 0,
) {
    companion object {
        const val STATUS_COMPLETED = "completed"
        const val STATUS_INTERRUPTED = "interrupted"
        const val STATUS_FAILED = "failed"
    }
}
