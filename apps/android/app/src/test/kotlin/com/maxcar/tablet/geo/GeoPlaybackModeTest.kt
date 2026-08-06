package com.maxcar.tablet.geo

import org.junit.Assert.assertEquals
import org.junit.Test

class GeoPlaybackModeTest {

    @Test
    fun `parses each known wire value`() {
        assertEquals(GeoPlaybackMode.IMMEDIATE, GeoPlaybackMode.from("IMMEDIATE"))
        assertEquals(GeoPlaybackMode.AFTER_CURRENT, GeoPlaybackMode.from("AFTER_CURRENT"))
        assertEquals(GeoPlaybackMode.MAX_WAIT, GeoPlaybackMode.from("MAX_WAIT"))
    }

    @Test
    fun `falls back to AFTER_CURRENT for null, empty or an unrecognized future value`() {
        assertEquals(GeoPlaybackMode.AFTER_CURRENT, GeoPlaybackMode.from(null))
        assertEquals(GeoPlaybackMode.AFTER_CURRENT, GeoPlaybackMode.from(""))
        assertEquals(GeoPlaybackMode.AFTER_CURRENT, GeoPlaybackMode.from("SOME_FUTURE_MODE"))
        assertEquals(GeoPlaybackMode.AFTER_CURRENT, GeoPlaybackMode.from("immediate")) // case-sensitive by design — server always sends uppercase
    }
}
