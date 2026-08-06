package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * MAX-012's circuit breaker: a creative that fails twice in a row (first
 * frame timeout, playback stall, duration watchdog or a real
 * PlaybackException — see [com.maxcar.tablet.ui.player.PlayerViewModel])
 * gets parked here instead of being retried forever, so one broken file
 * (the regular02/`c2.mtk.avc.decoder` incident this marco fixes) can never
 * block the rest of a REGULAR or GEO grade again.
 *
 * Keyed by [creativeId] **and** [sha256]: quarantine follows the *media
 * identity*, not the campaign — a campaign whose creative is replaced with
 * new, valid content is never held back by an old failure (item 11's core
 * rule). [sha256] is nullable only because a manifest entry can arrive
 * without a hash in principle; a null hash is treated as "any version of
 * this creativeId", the safer, more conservative behavior.
 */
@Entity(tableName = "media_quarantine")
data class MediaQuarantineEntity(
    @PrimaryKey val creativeId: String,
    val sha256: String?,
    val consecutiveFailures: Int,
    val lastFailureReason: String?,
    val lastFailureAtMillis: Long,
    val quarantinedUntilMillis: Long?,
) {
    fun isActive(nowMillis: Long): Boolean =
        quarantinedUntilMillis != null && nowMillis < quarantinedUntilMillis

    companion object {
        const val FAILURES_BEFORE_QUARANTINE = 2
        const val QUARANTINE_DURATION_MILLIS = 30 * 60 * 1000L
    }
}
