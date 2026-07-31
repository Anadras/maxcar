package com.maxcar.tablet.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Mirrors apps/admin/app/globals.css so the tablet's operational screens
// read as the same product as the admin panel, not a different one.
val MaxcarBgDeep = Color(0xFF0A1727)
val MaxcarSurface = Color(0xFF101F32)
val MaxcarBorder = Color(0xFF1E3350)
val MaxcarBlue = Color(0xFF267DFF)
val MaxcarBlueLight = Color(0xFF59A2FF)
val MaxcarGreen = Color(0xFF2BDA8B)
val MaxcarYellow = Color(0xFFF2B84B)
val MaxcarRed = Color(0xFFF0555A)
val MaxcarText = Color(0xFFEAF1FB)
val MaxcarMuted = Color(0xFF7390AA)

private val MaxcarColorScheme = darkColorScheme(
    primary = MaxcarBlueLight,
    secondary = MaxcarBlue,
    background = MaxcarBgDeep,
    surface = MaxcarSurface,
    onBackground = MaxcarText,
    onSurface = MaxcarText,
    error = MaxcarRed,
    outline = MaxcarBorder,
)

@Composable
fun MaxcarTheme(content: @Composable () -> Unit) {
    // The panel is dark-only today; the tablet follows suit rather than
    // introducing a light theme with no counterpart to match.
    MaterialTheme(colorScheme = MaxcarColorScheme, content = content)
}
