package com.maxcar.tablet.ui.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
            PlayerUiState.Initializing -> Unit
        }

        // A small, invisible tap target in a corner — deliberately not
        // styled as a button, so it isn't discoverable by a passenger
        // glancing at the screen.
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(64.dp)
                .pointerInput(Unit) {
                    detectTapGestures(onTap = { viewModel.onDiagnosticTap { showPinDialog = true } })
                },
        )
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
