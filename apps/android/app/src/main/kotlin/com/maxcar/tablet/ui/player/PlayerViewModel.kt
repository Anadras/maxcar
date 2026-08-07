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
import com.maxcar.tablet.data.local.MediaQuarantineDao
import com.maxcar.tablet.data.local.MediaQuarantineEntity
import com.maxcar.tablet.data.local.PlaybackState
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.data.repository.MediaPreparationStatus
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.geo.GeoPlaybackMode
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
 *
 * MAX-012 added the watchdog layer: TESTE01's regular02 incident proved
 * that a hung hardware decoder (`c2.mtk.avc.decoder`) can leave ExoPlayer
 * reporting `STATE_READY`/`isPlaying=true` for many *minutes* with no new
 * frame, no `onPlayerError`, nothing to react to — the app has to detect
 * that itself instead of trusting the player to eventually complain. Three
 * independent timers do that (first frame, playback position, declared
 * duration); whichever fires first wins and forces the same recovery path
 * a real [PlaybackException] already used: finish the item as failed,
 * track it toward quarantine, advance to the next READY item. See
 * docs/architecture/ANDROID_PLAYER_WATCHDOG.md.
 */
class PlayerViewModel(
    private val deviceRepository: DeviceRepository,
    private val mediaDownloadManager: MediaDownloadManager,
    private val appPreferences: AppPreferences,
    private val appContext: Context,
    private val geoEngine: GeoEngine,
    private val restartSignal: SharedFlow<Unit>,
    private val mediaQuarantineDao: MediaQuarantineDao,
    // Overridable so tests can exercise the continuous-recovery loop
    // without waiting on the real interval — production code always uses
    // the default (see [Factory], which never passes this explicitly).
    private val recoveryRetryIntervalMs: Long = RECOVERY_RETRY_INTERVAL_MS,
) : ViewModel() {

    // Muted by default (item 48): advertising inside a private vehicle
    // shouldn't presume the passenger wants audio. Remote-configurable
    // volume is a later marco; see ANDROID_MEDIA_CACHE.md.
    val exoPlayer: ExoPlayer = ExoPlayer.Builder(appContext).build().apply { volume = 0f }

    private val _uiState = MutableStateFlow<PlayerUiState>(PlayerUiState.Initializing)
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()
    private val _preparationStatus = MutableStateFlow(MediaPreparationStatus())
    val preparationStatus: StateFlow<MediaPreparationStatus> = _preparationStatus.asStateFlow()

    private var queue: List<PlaylistItemEntity> = emptyList()
    private var pendingQueue: List<PlaylistItemEntity>? = null
    private var index = 0
    private var consecutiveFailures = 0

    // Set only while a spliced-in GEO item is showing; unset the moment it
    // finishes. Its mere presence is what enforces "at most one GEO, then
    // back to REGULAR" (MAX-008 item 14): a GEO item's own finish handler
    // always calls advance() next, never re-checks for another GEO
    // candidate — offering one only ever happens right after a REGULAR
    // item completes. MAX-012 item 21 relaxed this slightly: a *strictly
    // higher priority* GEO candidate can still interrupt this one — see
    // [onGeoCandidateAvailable].
    private var playingGeoItem: GeoRuleEntity? = null

    private var itemStartedElapsedMs = 0L
    private var itemStartedAtIso = ""
    private var imageJob: Job? = null

    // MAX-011: the MAX_WAIT countdown for whichever geofence is currently
    // being waited on — at most one at a time, since a new candidate
    // (different geofence, or the same one re-evaluated) always cancels
    // and restarts it via [onGeoCandidateAvailable].
    private var geoWaitJob: Job? = null
    private var geoWaitGeofenceId: String? = null

    // MAX-012 watchdog state — all reset at the top of every [playItem].
    // [playToken] is what keeps a watchdog job that was scheduled for one
    // item from acting on a *different* one: [advance]/[restart]/a fresh
    // [playItem] call always increments it first, so a stale job's
    // captured token no longer matches and it quietly no-ops instead of
    // double-finishing whatever's now actually playing.
    private var playToken = 0
    private var itemFinished = false
    private var firstFrameRenderedAtMs: Long? = null
    private var lastKnownPositionMs = 0L
    private var lastPositionChangeAtMs = 0L
    private var firstFrameTimeoutJob: Job? = null
    private var durationWatchdogJob: Job? = null
    private var stallWatchdogJob: Job? = null
    // Only set while a GEO item is playing and hasn't yet been confirmed
    // (first frame rendered) — see the class doc and section 26 of the
    // MAX-012 brief: a GEO play only starts its cooldown once it's
    // actually been shown, never merely attempted.
    private var pendingGeoCooldownStart: GeoRuleEntity? = null

    private var tapCount = 0
    private var lastTapAt = 0L

    // MAX-014: the continuous-recovery loop started once every item in the
    // grade has failed in the same cycle — see [enterFallback]. Null
    // whenever the player isn't currently stuck.
    private var recoveryJob: Job? = null

    init {
        viewModelScope.launch {
            mediaDownloadManager.readyPlaylist.collect { items -> onQueueUpdated(items) }
        }
        viewModelScope.launch {
            mediaDownloadManager.preparationStatus.collect { status ->
                _preparationStatus.value = status
                if (_uiState.value is PlayerUiState.Empty) {
                    reportStatus(PlaybackState.NO_READY_MEDIA, null, null, status.diagnosticCode)
                }
            }
        }
        exoPlayer.addListener(
            object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_ENDED -> finishCurrentItem(completed = true, failureReason = null)
                        Player.STATE_BUFFERING ->
                            if (firstFrameRenderedAtMs != null) {
                                reportStatus(PlaybackState.BUFFERING, currentCampaignIdOrNull(), currentCreativeIdOrNull(), null)
                            }
                        else -> Unit
                    }
                }

                override fun onRenderedFirstFrame() {
                    lastKnownPositionMs = exoPlayer.currentPosition
                    markFirstFrameConfirmed()
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
        // MAX-011: IMMEDIATE/MAX_WAIT need to react the instant a candidate
        // becomes eligible, not just at the next item boundary — this is
        // the one path that can interrupt something already playing.
        // AFTER_CURRENT stays exactly as before: handled only inside
        // finishCurrentItem via geoEngine.consumeCandidate().
        viewModelScope.launch {
            geoEngine.nextCandidate.collect { candidate -> onGeoCandidateAvailable(candidate) }
        }
    }

    private fun currentCampaignIdOrNull(): String? =
        (playingGeoItem?.campaignId) ?: queue.getOrNull(index)?.campaignId

    private fun currentCreativeIdOrNull(): String? =
        (playingGeoItem?.creativeId) ?: queue.getOrNull(index)?.creativeId

    /** Shared by the ExoPlayer listener's `onRenderedFirstFrame` (video)
     * and the image branch of [playItem] (a decoded Compose bitmap has no
     * equivalent callback, and no decoder-hang risk to guard against, so
     * it's treated as confirmed the instant it's chosen to display): both
     * are "this item is genuinely showing something now" — the one moment
     * [pendingGeoCooldownStart] is allowed to actually start the cooldown
     * clock (section 26: an attempt that never rendered anything never
     * counts as displayed). */
    private fun markFirstFrameConfirmed() {
        firstFrameTimeoutJob?.cancel()
        firstFrameTimeoutJob = null
        firstFrameRenderedAtMs = SystemClock.elapsedRealtime()
        lastPositionChangeAtMs = SystemClock.elapsedRealtime()
        reportStatus(PlaybackState.PLAYING_CONFIRMED, currentCampaignIdOrNull(), currentCreativeIdOrNull(), null)
        pendingGeoCooldownStart?.let { rule ->
            pendingGeoCooldownStart = null
            viewModelScope.launch { geoEngine.onGeoPlayed(rule.geofenceId, rule.campaignId) }
        }
    }

    /** Reacts to a change in [GeoEngine.nextCandidate] — never consumes it
     * directly here except for IMMEDIATE/an expired MAX_WAIT timer, so
     * AFTER_CURRENT's existing item-boundary consumption in
     * [finishCurrentItem] is untouched. */
    private fun onGeoCandidateAvailable(candidate: GeoRuleEntity?) {
        if (candidate == null || candidate.geofenceId != geoWaitGeofenceId) {
            geoWaitJob?.cancel()
            geoWaitJob = null
            geoWaitGeofenceId = null
        }
        if (candidate == null) return
        // Never interrupt when there's nothing playing to interrupt (item
        // 13). A GEO already playing can still be interrupted, but only by
        // a *strictly higher* priority candidate (item 21, #2-#4) — equal
        // or lower priority never preempts what's already showing.
        val currentGeoPriority = playingGeoItem?.priority
        if (queue.isEmpty()) return
        if (currentGeoPriority != null && candidate.priority <= currentGeoPriority) return

        when (GeoPlaybackMode.from(candidate.playbackMode)) {
            GeoPlaybackMode.IMMEDIATE -> interruptForGeo()
            GeoPlaybackMode.MAX_WAIT -> {
                if (geoWaitGeofenceId == candidate.geofenceId) return // already counting down for this one
                geoWaitGeofenceId = candidate.geofenceId
                geoWaitJob = viewModelScope.launch {
                    delay(candidate.maxWaitSeconds * 1000L)
                    // Re-check freshness: the item may have finished on its
                    // own (handled by finishCurrentItem) or the candidate
                    // may have been withdrawn (cooldown/exit) while waiting.
                    if (geoEngine.nextCandidate.value?.geofenceId == candidate.geofenceId &&
                        queue.isNotEmpty()
                    ) {
                        interruptForGeo()
                    }
                    geoWaitGeofenceId = null
                }
            }
            GeoPlaybackMode.AFTER_CURRENT -> Unit
        }
    }

    /** Cuts whatever is currently playing short and splices the GEO
     * candidate in immediately (MAX-011 items 12/13, MAX-012 item 21): the
     * interrupted item — REGULAR or a lower-priority GEO — is recorded as
     * `interrupted`, never resumed. [index] itself is never rewound, so
     * [advance] always moves past an interrupted REGULAR item to the
     * *next* one once the GEO creative finishes. A quarantined candidate
     * is silently skipped (item 9: "não iniciar GEO sem mídia READY" —
     * quarantine is treated the same as not-READY). */
    private fun interruptForGeo() {
        val candidate = geoEngine.nextCandidate.value ?: return
        viewModelScope.launch {
            val quarantine = mediaQuarantineDao.get(candidate.creativeId)
            if (quarantine?.isActive(System.currentTimeMillis()) == true) return@launch
            doInterruptForGeo()
        }
    }

    private fun doInterruptForGeo() {
        val consumed = geoEngine.consumeCandidate() ?: return
        geoWaitJob?.cancel()
        geoWaitJob = null
        geoWaitGeofenceId = null

        val interruptedGeo = playingGeoItem
        val interruptedItem = interruptedGeo?.toPlaylistItem() ?: queue.getOrNull(index)
        if (interruptedItem != null) {
            val durationMs = SystemClock.elapsedRealtime() - itemStartedElapsedMs
            val offline = (uiState.value as? PlayerUiState.Playing)?.offline ?: false
            val startedAtIso = itemStartedAtIso
            viewModelScope.launch {
                deviceRepository.recordPlaybackEvent(
                    campaignId = interruptedItem.campaignId,
                    creativeId = interruptedItem.creativeId,
                    status = "interrupted",
                    startedAt = startedAtIso,
                    completedAt = Instant.now().toString(),
                    durationMs = durationMs,
                    completionPercentage = null,
                    failureReason = null,
                    offline = offline,
                )
            }
        }

        cancelWatchdogs()
        imageJob?.cancel()
        exoPlayer.stop()
        pendingGeoCooldownStart = null
        viewModelScope.launch { playGeoCandidate(consumed) }
    }

    /** Resets to the start of the current grade — recoverable, not a crash
     * workaround: used both for the remote restart_player command and as
     * the general "start clean" primitive a future maintenance-mode exit
     * (MAX-010) can reuse. */
    private fun restart() {
        recoveryJob?.cancel()
        recoveryJob = null
        cancelWatchdogs()
        playingGeoItem = null
        pendingGeoCooldownStart = null
        geoWaitJob?.cancel()
        geoWaitJob = null
        geoWaitGeofenceId = null
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
                reportStatus(
                    PlaybackState.NO_READY_MEDIA,
                    null,
                    null,
                    _preparationStatus.value.diagnosticCode,
                )
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
        pendingGeoCooldownStart = rule
        playItem(rule.toPlaylistItem(), index + 1, queue.size)
    }

    private fun playItem(item: PlaylistItemEntity, positionInQueue: Int, queueSize: Int) {
        // MAX-014: any real play attempt means we're no longer stuck —
        // auto-exits the continuous-recovery loop (see [enterFallback])
        // exactly as reliably as entering it, no separate "am I recovered
        // now" check needed.
        recoveryJob?.cancel()
        recoveryJob = null
        cancelWatchdogs()
        playToken++
        val token = playToken
        itemFinished = false
        firstFrameRenderedAtMs = null
        lastKnownPositionMs = 0L
        lastPositionChangeAtMs = SystemClock.elapsedRealtime()

        imageJob?.cancel()
        itemStartedElapsedMs = SystemClock.elapsedRealtime()
        itemStartedAtIso = Instant.now().toString()
        val offline = DeviceTelemetry.collect(appContext).networkType == "offline"
        _uiState.value = PlayerUiState.Playing(item, positionInQueue, queueSize, offline)
        reportStatus(PlaybackState.PREPARING, item.campaignId, item.creativeId, null)

        val localPath = item.localPath
        if (item.type == TYPE_VIDEO) {
            if (localPath == null || !File(localPath).exists()) {
                finishCurrentItem(completed = false, failureReason = "missing_local_file")
                return
            }
            exoPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(File(localPath))))
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true

            val declaredDurationMs = (item.durationSeconds.takeIf { it > 0 } ?: DEFAULT_IMAGE_DURATION_SECONDS)
                .let { (it * 1000).toLong() }

            // Watchdog 1/3 (section 7): no rendered frame at all within
            // FIRST_FRAME_TIMEOUT_MS — this is exactly the regular02
            // symptom (decoder stuck before ever producing a frame).
            firstFrameTimeoutJob = viewModelScope.launch {
                delay(FIRST_FRAME_TIMEOUT_MS)
                if (token != playToken) return@launch
                recordFailureAndAdvance(token, "first_frame_timeout")
            }

            // Watchdog 2/3 (section 9): never trust the decoder to
            // eventually raise PlaybackException — force an advance once
            // the item has clearly overrun its own declared duration.
            durationWatchdogJob = viewModelScope.launch {
                delay(declaredDurationMs + DURATION_GRACE_MS)
                if (token != playToken) return@launch
                recordFailureAndAdvance(token, "watchdog_timeout")
            }

            // Watchdog 3/3 (section 8): a decoder that renders a first
            // frame and then silently freezes (position never advances
            // again) while still reporting isPlaying/STATE_READY.
            stallWatchdogJob = viewModelScope.launch { runStallWatch(token) }
        } else {
            exoPlayer.stop()
            markFirstFrameConfirmed()
            val seconds = item.durationSeconds.takeIf { it > 0 } ?: DEFAULT_IMAGE_DURATION_SECONDS
            imageJob = viewModelScope.launch {
                delay((seconds * 1000).toLong())
                finishCurrentItem(completed = true, failureReason = null)
            }
        }
    }

    private suspend fun runStallWatch(token: Int) {
        var recoveryAttempted = false
        while (token == playToken) {
            delay(STALL_CHECK_INTERVAL_MS)
            if (token != playToken) return
            if (firstFrameRenderedAtMs == null) continue // first-frame watchdog owns this phase
            val position = exoPlayer.currentPosition
            val isActivelyPlaying = exoPlayer.isPlaying && exoPlayer.playbackState == Player.STATE_READY
            if (position != lastKnownPositionMs) {
                lastKnownPositionMs = position
                lastPositionChangeAtMs = SystemClock.elapsedRealtime()
                recoveryAttempted = false
                continue
            }
            if (!isActivelyPlaying) continue // legitimately paused/buffering, not a stall
            val stalledForMs = SystemClock.elapsedRealtime() - lastPositionChangeAtMs
            if (stalledForMs < STALL_TIMEOUT_MS) continue

            if (!recoveryAttempted) {
                recoveryAttempted = true
                reportStatus(PlaybackState.STALLED, currentCampaignIdOrNull(), currentCreativeIdOrNull(), "playback_stall")
                reportStatus(PlaybackState.RECOVERING, currentCampaignIdOrNull(), currentCreativeIdOrNull(), "playback_stall")
                // Section 8's "one short recovery attempt": a play() kick
                // is the least invasive nudge available without tearing
                // down and re-preparing the whole item.
                exoPlayer.play()
                lastPositionChangeAtMs = SystemClock.elapsedRealtime()
                continue
            }
            // The kick didn't help — give up on this item rather than
            // retrying forever on the same broken file (section 8: "não
            // criar loop infinito de tentativas no mesmo arquivo").
            recordFailureAndAdvance(token, "playback_stall")
            return
        }
    }

    private fun cancelWatchdogs() {
        firstFrameTimeoutJob?.cancel()
        firstFrameTimeoutJob = null
        durationWatchdogJob?.cancel()
        durationWatchdogJob = null
        stallWatchdogJob?.cancel()
        stallWatchdogJob = null
    }

    /** The unified watchdog failure path (section 7-9): identical outcome
     * to a real [PlaybackException] — finish the item as failed and
     * advance — but triggered by the app's own timers instead of waiting
     * for the decoder to ever admit it's stuck. [token] guards against a
     * watchdog that was scheduled for an item that's already moved on
     * (e.g. it finished normally right before the timer fired). */
    private fun recordFailureAndAdvance(token: Int, reason: String) {
        if (token != playToken) return
        cancelWatchdogs()
        finishCurrentItem(completed = false, failureReason = reason)
    }

    private fun finishCurrentItem(completed: Boolean, failureReason: String?) {
        // Idempotency guard: a real PlaybackException and a watchdog can
        // both target the same item in a narrow race — only the first one
        // to arrive gets to record the event and advance.
        if (itemFinished) return
        itemFinished = true
        cancelWatchdogs()

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
        if (!completed) {
            viewModelScope.launch { registerFailureForQuarantine(item.creativeId, item.sha256, failureReason) }
        }

        if (geoItem != null) {
            // A GEO play never counts toward the REGULAR queue's own
            // failure budget — it isn't part of that grade. A GEO that
            // never rendered a first frame never started its cooldown
            // either (section 26).
            playingGeoItem = null
            pendingGeoCooldownStart = null
            if (!completed) reportStatus(PlaybackState.MEDIA_ERROR, item.campaignId, item.creativeId, failureReason)
            viewModelScope.launch {
                if (!completed) delay(FAILURE_BACKOFF_MS)
                advance()
            }
            return
        }

        consecutiveFailures = if (completed) 0 else consecutiveFailures + 1
        if (!completed) reportStatus(PlaybackState.MEDIA_ERROR, item.campaignId, item.creativeId, failureReason)
        viewModelScope.launch {
            // A short pause avoids pegging the CPU if every item in the
            // grade fails back to back (item 22: never a hot-looping
            // retry on the same error).
            if (!completed) delay(FAILURE_BACKOFF_MS)
            // A GEO candidate is only ever offered right after a REGULAR
            // item finishes *successfully* (MAX-008 item 3): a failed item
            // already needs its own retry/backoff attention, not a GEO ad
            // layered on top of it.
            val geoCandidate = if (completed) consumeGeoCandidateIfNotQuarantined() else null
            if (geoCandidate != null) {
                playGeoCandidate(geoCandidate)
            } else {
                advance()
            }
        }
    }

    private suspend fun consumeGeoCandidateIfNotQuarantined(): GeoRuleEntity? {
        val candidate = geoEngine.nextCandidate.value ?: return null
        val quarantine = mediaQuarantineDao.get(candidate.creativeId)
        if (quarantine?.isActive(System.currentTimeMillis()) == true) return null
        return geoEngine.consumeCandidate()
    }

    /** MAX-012's circuit breaker (section 11): two consecutive failures for
     * the same creative+hash quarantines it for [MediaQuarantineEntity.QUARANTINE_DURATION_MILLIS] —
     * long enough that a transient hiccup doesn't cost a full grade cycle
     * every time, short enough that a real fix (or simply time) restores
     * it without manual intervention. A hash change (new upload) always
     * clears prior failures — the identity is the media, not the
     * campaign. */
    private suspend fun registerFailureForQuarantine(creativeId: String, sha256: String?, reason: String?) {
        val now = System.currentTimeMillis()
        val existing = mediaQuarantineDao.get(creativeId)
        val failures = if (existing != null && (existing.sha256 == sha256 || sha256 == null)) {
            existing.consecutiveFailures + 1
        } else {
            1
        }
        val quarantinedUntil = if (failures >= MediaQuarantineEntity.FAILURES_BEFORE_QUARANTINE) {
            now + MediaQuarantineEntity.QUARANTINE_DURATION_MILLIS
        } else {
            null
        }
        mediaQuarantineDao.upsert(
            MediaQuarantineEntity(
                creativeId = creativeId,
                sha256 = sha256,
                consecutiveFailures = failures,
                lastFailureReason = reason,
                lastFailureAtMillis = now,
                quarantinedUntilMillis = quarantinedUntil,
            ),
        )
    }

    private fun advance() {
        if (consecutiveFailures >= queue.size && queue.isNotEmpty()) {
            enterFallback("all_items_failed")
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
                enterFallback("empty_playlist")
                return
            }
        }
        playCurrent()
    }

    /**
     * MAX-014: replaces the old permanent give-up — a real pilot incident
     * (TESTE01, 2026-08-06) showed a small grade where every item failed
     * at least once tripping [advance]'s old "give up" branch and leaving
     * the tablet dark with no way back except a remote restart_player
     * command or a manual `adb`/app restart. Neither a quarantine window
     * elapsing nor a fresh manifest syncing in the background writes
     * anything Room would treat as "changed" for an *already-failed* item,
     * so nothing would ever have woken the old code back up on its own.
     *
     * This starts (if not already running) a timer that keeps re-checking
     * [MediaDownloadManager.currentlyReadyItems] — a fresh, time-aware
     * query, not the cached [queue] — until something is playable again,
     * then resumes automatically. [PlayerUiState.Fallback] is shown
     * locally the whole time: no network dependency, no reliance on any
     * previously-downloaded (and possibly exactly what's broken) creative.
     */
    private fun enterFallback(reason: String) {
        _uiState.value = PlayerUiState.Fallback(reason)
        reportStatus(PlaybackState.NO_READY_MEDIA, null, null, reason)
        if (recoveryJob?.isActive == true) return
        recoveryJob = viewModelScope.launch {
            while (true) {
                delay(recoveryRetryIntervalMs)
                attemptRecovery()
            }
        }
    }

    /** One recovery poll: if anything is genuinely playable right now,
     * adopt it as the new grade and resume — [playItem] (called via
     * [playCurrent]) cancels this same loop the moment it runs, so a
     * successful recovery is also always the last iteration. Finding
     * nothing is not an error, just "still waiting" — the loop simply
     * continues to its next scheduled check. */
    private suspend fun attemptRecovery() {
        val candidates = mediaDownloadManager.currentlyReadyItems()
        if (candidates.isEmpty()) return
        pendingQueue = null
        queue = candidates
        index = 0
        consecutiveFailures = 0
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
        recoveryJob?.cancel()
        cancelWatchdogs()
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
        private val mediaQuarantineDao: MediaQuarantineDao,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            PlayerViewModel(
                deviceRepository, mediaDownloadManager, appPreferences, appContext, geoEngine, restartSignal,
                mediaQuarantineDao,
            ) as T
    }

    companion object {
        const val TYPE_VIDEO = "video"
        const val DEFAULT_IMAGE_DURATION_SECONDS = 10.0
        const val FAILURE_BACKOFF_MS = 500L
        const val TAPS_TO_UNLOCK = 5
        // MAX-013: 5 taps inside the corner target within 3s — a slower
        // sequence (a genuinely accidental run of taps, not a deliberate
        // fast gesture) never opens the PIN dialog.
        const val TAP_WINDOW_MS = 3000L

        // Section 7: first frame must render within this window or the
        // item is treated as stuck, exactly like regular02 never did.
        const val FIRST_FRAME_TIMEOUT_MS = 5_000L
        // Section 8: how often the position-stall watchdog samples, and
        // how long a genuinely-playing item may go without its position
        // changing before it's treated as stalled.
        const val STALL_CHECK_INTERVAL_MS = 2_000L
        const val STALL_TIMEOUT_MS = 5_000L
        // Section 9: hard ceiling per item, independent of the decoder
        // ever raising an error — declared duration plus a short grace
        // window for normal EOS handling latency.
        const val DURATION_GRACE_MS = 5_000L

        // MAX-014: how often the continuous-recovery loop re-checks for
        // playable content once the whole grade has failed. Frequent
        // enough that a quarantine expiring or a fresh sync arriving is
        // noticed promptly; infrequent enough not to matter for battery/
        // CPU on a kiosk tablet sitting dark anyway.
        const val RECOVERY_RETRY_INTERVAL_MS = 30_000L
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
