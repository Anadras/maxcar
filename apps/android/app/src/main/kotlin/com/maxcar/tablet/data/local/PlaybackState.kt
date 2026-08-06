package com.maxcar.tablet.data.local

/**
 * MAX-012 section 3's richer player-state vocabulary — deliberately its
 * own tiny, dependency-free object rather than living inside
 * [com.maxcar.tablet.ui.player.PlayerViewModel] itself: both that
 * ViewModel (the writer, via [AppPreferences.setPlayerStatus]) and
 * [com.maxcar.tablet.sync.SyncCoordinator] (a reader, mapping it onto the
 * heartbeat's `operationalStatus`) need these exact string constants, and
 * `sync` has no business depending on the `ui.player` package just for a
 * handful of string literals.
 *
 * Never report [PLAYING_CONFIRMED] without all of: `Player.STATE_READY`,
 * `isPlaying`, a rendered first frame, and a recently-advancing position —
 * see docs/architecture/ANDROID_PLAYER_WATCHDOG.md. The old two-state
 * "playing"/"empty" heartbeat vocabulary this replaces could be — and on
 * TESTE01's regular02 incident, was — true for many minutes with a frozen
 * screen underneath it.
 */
object PlaybackState {
    const val PREPARING = "preparing"
    const val BUFFERING = "buffering"
    const val PLAYING_CONFIRMED = "playing_confirmed"
    const val STALLED = "stalled"
    const val RECOVERING = "recovering"
    const val MEDIA_ERROR = "media_error"
    const val NO_READY_MEDIA = "no_ready_media"
}
