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

    /** No READY item exists — nothing has synced yet, everything failed,
     * or the grade is genuinely empty. */
    data object Empty : PlayerUiState()

    data class Playing(
        val item: PlaylistItemEntity,
        val positionInQueue: Int,
        val queueSize: Int,
        val offline: Boolean,
    ) : PlayerUiState()
}
