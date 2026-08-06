package com.maxcar.tablet.geo

/**
 * When a GEO campaign should take over from whatever's currently playing,
 * on entering its geofence (MAX-011). Parsed from the raw wire string on
 * [com.maxcar.tablet.data.local.GeoRuleEntity.playbackMode] rather than
 * stored as this type directly, so an unrecognized value (a future mode a
 * server ahead of this app build might send) falls back safely to
 * [AFTER_CURRENT] — today's original, always-safe behavior — instead of a
 * deserialization crash.
 */
enum class GeoPlaybackMode {
    /** Interrupts the currently playing REGULAR item within ~2s of the
     * geofence being entered — never resumes the interrupted item; the
     * queue simply advances to the next REGULAR item once the GEO
     * creative finishes. */
    IMMEDIATE,

    /** MAX-008's original behavior: only offered as a candidate once the
     * current item finishes on its own. */
    AFTER_CURRENT,

    /** Waits for the current item to finish, up to
     * [com.maxcar.tablet.data.local.GeoRuleEntity.maxWaitSeconds]; if that
     * elapses first, interrupts exactly like [IMMEDIATE]. */
    MAX_WAIT,
    ;

    companion object {
        fun from(wireValue: String?): GeoPlaybackMode =
            entries.firstOrNull { it.name == wireValue } ?: AFTER_CURRENT
    }
}
