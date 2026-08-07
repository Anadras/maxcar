package com.maxcar.tablet.ui.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.maxcar.tablet.kiosk.MaintenanceAccessController
import com.maxcar.tablet.data.repository.MediaPreparationStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The tablet's default screen once enrolled with a ready grade: fullscreen,
 * no visible controls, no obvious way for a passenger to leave it. A
 * five-tap corner gesture opens [MaintenancePinDialog] (MAX-010) — never
 * diagnostics directly; the gesture alone was never meant to be the
 * security boundary, only the PIN is.
 */
@Composable
fun PlayerScreen(
    viewModel: PlayerViewModel,
    maintenanceAccessController: MaintenanceAccessController,
    onOpenDiagnostics: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val preparationStatus by viewModel.preparationStatus.collectAsState()
    var showPinDialog by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        when (val current = state) {
            is PlayerUiState.Playing -> {
                if (current.item.type == "video") {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context -> createPlayerView(context, viewModel.exoPlayer) },
                    )
                } else {
                    LocalImageItem(path = current.item.localPath)
                }
            }
            PlayerUiState.Empty -> NoContentScreen(preparationStatus)
            is PlayerUiState.Fallback -> LocalFallbackScreen()
            PlayerUiState.Initializing -> Unit
        }

        // MAX-013's new gesture: an invisible ~8%-of-screen square in the
        // top-right corner, inside the safe-drawing area (so it never
        // overlaps a status/notification cutout even if system bars are
        // ever transiently visible) — deliberately not styled as a
        // button, so it isn't discoverable by a passenger glancing at the
        // screen. Real screen coordinates via BoxWithConstraints, not a
        // fixed dp size, so the target stays proportionally in the corner
        // regardless of the tablet's actual resolution.
        BoxWithConstraints(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(width = maxWidth * 0.08f, height = maxHeight * 0.08f)
                    .pointerInput(Unit) {
                        detectTapGestures(onTap = { viewModel.onDiagnosticTap { showPinDialog = true } })
                    },
            )
        }
    }

    if (showPinDialog) {
        MaintenancePinDialog(
            controller = maintenanceAccessController,
            onDismiss = { showPinDialog = false },
            onUnlocked = {
                showPinDialog = false
                onOpenDiagnostics()
            },
        )
    }
}

@OptIn(UnstableApi::class)
private fun createPlayerView(context: Context, exoPlayer: ExoPlayer): PlayerView =
    PlayerView(context).apply {
        player = exoPlayer
        useController = false
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    }

@Composable
private fun LocalImageItem(path: String?) {
    var bitmap by remember(path) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(path) {
        bitmap = path?.let { withContext(Dispatchers.IO) { BitmapFactory.decodeFile(it) } }
    }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun NoContentScreen(status: MediaPreparationStatus) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = "MAXCAR\n\n${status.passengerTitle}\n${status.passengerMessage}",
            color = Color(0xFFEAF1FB),
            textAlign = TextAlign.Center,
        )
    }
}

/** MAX-014: shown while [PlayerViewModel]'s continuous-recovery loop is
 * polling for playable content — entirely local (no network call, no
 * dependency on any previously-downloaded creative, since a broken
 * creative is exactly what can put the player here). Deliberately never
 * says "erro" to a passenger glancing at the screen; this is a normal,
 * self-healing state, not a fault report. */
@Composable
private fun LocalFallbackScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = "MAXCAR",
            color = Color(0xFFEAF1FB),
            textAlign = TextAlign.Center,
        )
    }
}
