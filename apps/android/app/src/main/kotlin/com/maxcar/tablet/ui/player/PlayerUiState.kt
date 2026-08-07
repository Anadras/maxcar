package com.maxcar.tablet.ui.player

import com.maxcar.tablet.data.local.PlaylistItemEntity

/**
 * The player's own technical state, shown to the operator (never the
 * passenger) without ever exposing a stack trace. Mirrors item 21 of the
 * MAX-007 brief, simplified to what the pilot's single-queue player
 * actually distinguishes: sync/download happen in [MediaDownloadManager]
 * and are reflected here only as "do we have anything to show yet".
 */
sealed class PlayerUiState {
    /** Room hasn't reported its first snapshot yet. */
    data object Initializing : PlayerUiState()

    /** Nothing has ever synced, or the grade is genuinely empty — there is
     * no content to be "recovering" from. */
    data object Empty : PlayerUiState()

    /** MAX-014: every item in the grade just failed in the same cycle
     * (consecutiveFailures reached queue size) — content exists but none
     * of it is currently playable. Distinct from [Empty] so the operator
     * and the on-screen fallback can say "recovering", not "waiting for a
     * first sync" — and so [PlayerViewModel]'s continuous-recovery loop
     * knows to keep polling instead of just sitting idle forever the way
     * the original queue-exhaustion bug did. */
    data class Fallback(val reason: String) : PlayerUiState()

    data class Playing(
        val item: PlaylistItemEntity,
        val positionInQueue: Int,
        val queueSize: Int,
        val offline: Boolean,
    ) : PlayerUiState()
}
