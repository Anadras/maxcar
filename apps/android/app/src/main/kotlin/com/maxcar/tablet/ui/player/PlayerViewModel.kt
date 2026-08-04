package com.maxcar.tablet.ui.player

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.work.DeviceTelemetry
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant

/**
 * Owns the single ExoPlayer instance and the regular-grade queue: which
 * item is showing, when to advance, and what gets recorded as a playback
 * event. Video plays through ExoPlayer; images are timed in Compose (see
 * [PlayerScreen]) — two content types, one state machine, so a mixed grade
 * never has two different engines racing to decide what's "current".
 */
class PlayerViewModel(
    private val deviceRepository: DeviceRepository,
    private val mediaDownloadManager: MediaDownloadManager,
    private val appPreferences: AppPreferences,
    private val appContext: Context,
    private val geoEngine: GeoEngine,
    private val restartSignal: SharedFlow<Unit>,
) : ViewModel() {

    // Muted by default (item 48): advertising inside a private vehicle
    // shouldn't presume the passenger wants audio. Remote-configurable
    // volume is a later marco; see ANDROID_MEDIA_CACHE.md.
    val exoPlayer: ExoPlayer = ExoPlayer.Builder(appContext).build().apply { volume = 0f }

    private val _uiState = MutableStateFlow<PlayerUiState>(PlayerUiState.Initializing)
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    private var queue: List<PlaylistItemEntity> = emptyList()
    private var pendingQueue: List<PlaylistItemEntity>? = null
    private var index = 0
    private var consecutiveFailures = 0

    // Set only while a spliced-in GEO item is showing; unset the moment it
    // finishes. Its mere presence is what enforces "at most one GEO, then
    // back to REGULAR" (MAX-008 item 14): a GEO item's own finish handler
    // always calls advance() next, never re-checks for another GEO
    // candidate — offering one only ever happens right after a REGULAR
    // item completes.
    private var playingGeoItem: GeoRuleEntity? = null

    private var itemStartedElapsedMs = 0L
    private var itemStartedAtIso = ""
    private var imageJob: Job? = null

    private var tapCount = 0
    private var lastTapAt = 0L

    init {
        viewModelScope.launch {
            mediaDownloadManager.readyPlaylist.collect { items -> onQueueUpdated(items) }
        }
        exoPlayer.addListener(
            object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) finishCurrentItem(completed = true, failureReason = null)
                }

                override fun onPlayerError(error: PlaybackException) {
                    finishCurrentItem(completed = false, failureReason = error::class.simpleName)
                }
            },
        )
        // MAX-009's restart_player remote command (item 51): the only
        // signal that ever reaches the player from outside itself, since
        // DeviceCommandExecutor runs in a background worker with no
        // Activity/ViewModel reference of its own.
        viewModelScope.launch {
            restartSignal.collect { restart() }
        }
    }

    /** Resets to the start of the current grade — recoverable, not a crash
     * workaround: used both for the remote restart_player command and as
     * the general "start clean" primitive a future maintenance-mode exit
     * (MAX-010) can reuse. */
    private fun restart() {
        playingGeoItem = null
        imageJob?.cancel()
        exoPlayer.stop()
        index = 0
        consecutiveFailures = 0
        if (queue.isNotEmpty()) playCurrent() else _uiState.value = PlayerUiState.Empty
    }

    /** The hidden way into the diagnostic screen from the player (item 26):
     * five taps in a corner within [TAP_WINDOW_MS]. */
    fun onDiagnosticTap(onUnlock: () -> Unit) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTapAt > TAP_WINDOW_MS) tapCount = 0
        lastTapAt = now
        tapCount++
        if (tapCount >= TAPS_TO_UNLOCK) {
            tapCount = 0
            onUnlock()
        }
    }

    private fun onQueueUpdated(items: List<PlaylistItemEntity>) {
        if (queue.isEmpty()) {
            queue = items
            index = 0
            consecutiveFailures = 0
            if (items.isEmpty()) {
                _uiState.value = PlayerUiState.Empty
                reportStatus(STATE_EMPTY, null, null, null)
            } else {
                playCurrent()
            }
        } else {
            // A video mid-playback is never interrupted by a manifest
            // update (item 23): the new grade only takes over once the
            // current loop finishes.
            pendingQueue = items
        }
    }

    private fun playCurrent() {
        if (queue.isEmpty()) {
            _uiState.value = PlayerUiState.Empty
            return
        }
        playItem(queue[index], index + 1, queue.size)
    }

    /** Splices a GEO creative in as the very next item (MAX-008 item 3):
     * called only from [finishCurrentItem], after a REGULAR item has
     * already finished normally — never while something is still playing,
     * and never in place of a queued REGULAR item, which stays exactly
     * where it is and plays right after this one. */
    private fun playGeoCandidate(rule: GeoRuleEntity) {
        playingGeoItem = rule
        playItem(rule.toPlaylistItem(), index + 1, queue.size)
    }

    private fun playItem(item: PlaylistItemEntity, positionInQueue: Int, queueSize: Int) {
        imageJob?.cancel()
        itemStartedElapsedMs = SystemClock.elapsedRealtime()
        itemStartedAtIso = Instant.now().toString()
        val offline = DeviceTelemetry.collect(appContext).networkType == "offline"
        _uiState.value = PlayerUiState.Playing(item, positionInQueue, queueSize, offline)
        reportStatus(STATE_PLAYING, item.campaignId, item.creativeId, null)

        val localPath = item.localPath
        if (item.type == TYPE_VIDEO) {
            if (localPath == null || !File(localPath).exists()) {
                finishCurrentItem(completed = false, failureReason = "missing_local_file")
                return
            }
            exoPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(File(localPath))))
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true
        } else {
            exoPlayer.stop()
            val seconds = item.durationSeconds.takeIf { it > 0 } ?: DEFAULT_IMAGE_DURATION_SECONDS
            imageJob = viewModelScope.launch {
                delay((seconds * 1000).toLong())
                finishCurrentItem(completed = true, failureReason = null)
            }
        }
    }

    private fun finishCurrentItem(completed: Boolean, failureReason: String?) {
        val geoItem = playingGeoItem
        val item = geoItem?.toPlaylistItem() ?: queue.getOrNull(index) ?: return
        val durationMs = SystemClock.elapsedRealtime() - itemStartedElapsedMs
        val offline = (uiState.value as? PlayerUiState.Playing)?.offline ?: false
        viewModelScope.launch {
            deviceRepository.recordPlaybackEvent(
                campaignId = item.campaignId,
                creativeId = item.creativeId,
                status = if (completed) "completed" else "failed",
                startedAt = itemStartedAtIso,
                completedAt = Instant.now().toString(),
                durationMs = durationMs,
                completionPercentage = if (completed) 100 else null,
                failureReason = failureReason,
                offline = offline,
            )
        }

        if (geoItem != null) {
            // A GEO play never counts toward the REGULAR queue's own
            // failure budget — it isn't part of that grade.
            playingGeoItem = null
            if (!completed) reportStatus(STATE_PLAYING, item.campaignId, item.creativeId, failureReason)
            viewModelScope.launch {
                if (!completed) delay(FAILURE_BACKOFF_MS)
                advance()
            }
            return
        }

        consecutiveFailures = if (completed) 0 else consecutiveFailures + 1
        if (!completed) reportStatus(STATE_PLAYING, item.campaignId, item.creativeId, failureReason)
        viewModelScope.launch {
            // A short pause avoids pegging the CPU if every item in the
            // grade fails back to back (item 22: never a hot-looping
            // retry on the same error).
            if (!completed) delay(FAILURE_BACKOFF_MS)
            // A GEO candidate is only ever offered right after a REGULAR
            // item finishes *successfully* (MAX-008 item 3): a failed item
            // already needs its own retry/backoff attention, not a GEO ad
            // layered on top of it.
            val geoCandidate = if (completed) geoEngine.consumeCandidate() else null
            if (geoCandidate != null) {
                geoEngine.onGeoPlayed(geoCandidate.geofenceId, geoCandidate.campaignId)
                playGeoCandidate(geoCandidate)
            } else {
                advance()
            }
        }
    }

    private fun advance() {
        if (consecutiveFailures >= queue.size && queue.isNotEmpty()) {
            _uiState.value = PlayerUiState.Empty
            return
        }
        index++
        if (index >= queue.size) {
            index = 0
            pendingQueue?.let {
                queue = it
                pendingQueue = null
                consecutiveFailures = 0
            }
            if (queue.isEmpty()) {
                _uiState.value = PlayerUiState.Empty
                return
            }
        }
        playCurrent()
    }

    /** Best-effort write so [com.maxcar.tablet.work.HeartbeatWorker] can
     * report what the foreground player is doing; never lets a DataStore
     * hiccup affect playback. */
    private fun reportStatus(state: String, campaignId: String?, creativeId: String?, lastError: String?) {
        viewModelScope.launch {
            runCatching { appPreferences.setPlayerStatus(state, campaignId, creativeId, lastError) }
        }
    }

    override fun onCleared() {
        exoPlayer.release()
        super.onCleared()
    }

    class Factory(
        private val deviceRepository: DeviceRepository,
        private val mediaDownloadManager: MediaDownloadManager,
        private val appPreferences: AppPreferences,
        private val appContext: Context,
        private val geoEngine: GeoEngine,
        private val restartSignal: SharedFlow<Unit>,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            PlayerViewModel(
                deviceRepository, mediaDownloadManager, appPreferences, appContext, geoEngine, restartSignal,
            ) as T
    }

    private companion object {
        const val TYPE_VIDEO = "video"
        const val DEFAULT_IMAGE_DURATION_SECONDS = 10.0
        const val FAILURE_BACKOFF_MS = 500L
        const val TAPS_TO_UNLOCK = 5
        const val TAP_WINDOW_MS = 2000L
        const val STATE_PLAYING = "playing"
        const val STATE_EMPTY = "empty"
    }
}

/** A GEO rule plays through the exact same [PlaylistItemEntity]-shaped
 * player logic as a REGULAR item (MAX-008 item 24: one media pipeline, no
 * GEO streaming) — position/manifestVersion are meaningless for a
 * transient splice-in, so they carry harmless placeholder values never
 * read back for a GEO play. */
private fun GeoRuleEntity.toPlaylistItem(): PlaylistItemEntity = PlaylistItemEntity(
    creativeId = creativeId,
    campaignId = campaignId,
    type = type,
    mimeType = mimeType,
    durationSeconds = durationSeconds,
    fileSizeBytes = fileSizeBytes,
    sha256 = sha256,
    position = 0,
    manifestVersion = rulesVersion,
    downloadStatus = downloadStatus,
    localPath = localPath,
    lastError = lastError,
    updatedAt = updatedAt,
)
