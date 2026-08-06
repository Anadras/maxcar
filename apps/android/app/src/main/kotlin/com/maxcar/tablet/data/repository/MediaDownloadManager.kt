package com.maxcar.tablet.data.repository

import android.content.Context
import android.os.StatFs
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.MediaQuarantineDao
import com.maxcar.tablet.data.local.PlaylistItemDao
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.ManifestPlaylistItem
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import kotlin.math.abs

/**
 * Turns a fetched manifest into a validated, fully local media grade. The
 * player (ui/player) only ever reads [PlaylistItemDao.observeReady] — this
 * class is the single writer of download state. See
 * docs/architecture/ANDROID_MEDIA_CACHE.md for the atomic-swap and
 * integrity rules implemented here.
 */
class MediaDownloadManager(
    private val context: Context,
    private val apiClient: DeviceApiClient,
    private val deviceIdentity: DeviceIdentityProvider,
    private val playlistItemDao: PlaylistItemDao,
    private val appPreferences: AppPreferences,
    private val mediaQuarantineDao: MediaQuarantineDao,
    // Overridable so tests can exercise the low-storage path without
    // needing a real device with a (nearly) full disk; production code
    // always uses the default.
    private val minFreeBytes: Long = MIN_FREE_BYTES,
) {
    private val mediaDir: File by lazy {
        File(context.filesDir, "media").apply { mkdirs() }
    }

    /** The only thing the player reads: locally validated items, in grade
     * order, further filtered to what the local clock says is currently
     * valid (MAX-009 item 46) — never PENDING/DOWNLOADING/FAILED/OBSOLETE
     * rows, and never an item whose starts_at/ends_at the tablet's own
     * clock has moved past, and never a creative MAX-012's watchdog has
     * quarantined after repeated failures (section 11/13: a bad file must
     * never be able to block the rest of the grade).
     *
     * That local-clock filter is skipped entirely when the last known
     * clock skew is severe (`SEVERE_CLOCK_SKEW_SECONDS`): a tablet whose
     * clock is badly wrong shouldn't cut content it can't actually judge
     * the validity of — better to keep playing than to wrongly go dark
     * because of a bad clock. A small/unknown skew is trusted; see
     * [AppPreferences.clockSkewSeconds] for how it's measured. */
    val readyPlaylist: Flow<List<PlaylistItemEntity>> =
        combine(
            playlistItemDao.observeReady(),
            appPreferences.clockSkewSeconds,
            mediaQuarantineDao.observeAll(),
        ) { items, skewSeconds, quarantined ->
            val clockIsTrustworthy = skewSeconds == null || abs(skewSeconds) < SEVERE_CLOCK_SKEW_SECONDS
            val now = System.currentTimeMillis()
            val quarantinedIds = quarantined.filter { it.isActive(now) }.map { it.creativeId }.toSet()
            items
                .filter { clockIsTrustworthy.not() || it.isCurrentlyValid(now) }
                .filter { it.creativeId !in quarantinedIds }
        }

    /** How many of the currently-synced creatives are sitting out a
     * quarantine window right now — surfaced on the heartbeat (MAX-012
     * section 14) so the panel can tell "nothing to play because nothing
     * synced yet" apart from "several files are actually broken". */
    suspend fun quarantinedMediaCount(): Int = mediaQuarantineDao.countActive(System.currentTimeMillis())

    /** A small, non-sensitive explanation of why the player has nothing
     * to show. This is intentionally derived from local Room state: it is
     * useful even while fully offline and never contains a signed URL,
     * token or stack trace. */
    val preparationStatus: Flow<MediaPreparationStatus> =
        combine(playlistItemDao.observeAll(), readyPlaylist) { all, playable ->
            summarizeMediaPreparation(all, playable.size)
        }

    suspend fun readyCount(): Int = playlistItemDao.countReady()

    /**
     * Fetches the manifest, downloads whatever changed, and only then
     * removes anything no longer in the grade. Safe to call repeatedly:
     * an already-[PlaylistItemEntity.STATUS_READY] item whose hash still
     * matches is never re-downloaded, and a previously
     * [PlaylistItemEntity.STATUS_FAILED] item is retried automatically on
     * the next call, since only READY items are skipped.
     */
    suspend fun sync(): Result<Unit> = runCatching {
        val keyId = deviceIdentity.currentKeyId()
            ?: throw DeviceApiError.CredentialUnavailable("No local device identity.")
        val manifest = withContext(Dispatchers.IO) { apiClient.getManifest(keyId) }
        val incoming = manifest.playlist.associateBy { it.creativeId }
        val existing = playlistItemDao.getAll().associateBy { it.creativeId }
        val now = System.currentTimeMillis()

        // MAX-012 item 11: a creative that comes back from the manifest
        // with a different hash than what's quarantined is a genuinely
        // different file — a re-upload that fixed the problem must never
        // stay blocked by the old failure count.
        for (item in manifest.playlist) mediaQuarantineDao.clearIfHashChanged(item.creativeId, item.sha256)

        val toUpsert = manifest.playlist.map { item ->
            existing[item.creativeId]
                ?.takeIf {
                    it.downloadStatus == PlaylistItemEntity.STATUS_READY &&
                        it.sha256 == item.sha256 &&
                        it.localPath?.let { path -> File(path).exists() } == true
                }
                // Unchanged and already on disk: keep the file, just
                // refresh position/metadata in case the grade reordered or
                // the campaign's own validity window changed.
                ?.copy(
                    position = item.position,
                    manifestVersion = manifest.manifestVersion,
                    startsAt = item.startsAt,
                    endsAt = item.endsAt,
                    updatedAt = now,
                )
                ?: item.toPendingEntity(manifest.manifestVersion, now)
        }
        playlistItemDao.upsertAll(toUpsert)

        for (item in manifest.playlist) {
            val row = playlistItemDao.get(item.creativeId) ?: continue
            if (row.downloadStatus == PlaylistItemEntity.STATUS_READY) continue
            val downloadUrl = incoming[item.creativeId]?.downloadUrl
            if (downloadUrl == null) {
                playlistItemDao.updateStatus(
                    item.creativeId,
                    PlaylistItemEntity.STATUS_FAILED,
                    null,
                    "missing_download_url",
                    System.currentTimeMillis(),
                )
                continue
            }
            downloadOne(item, downloadUrl)
        }

        // Atomic swap: the old grade's files are only removed now, after
        // every item in the new manifest has been processed (READY or
        // permanently FAILED) — never before, so the player always has
        // something to show.
        if (incoming.isEmpty()) {
            existing.values.forEach { removeLocalFile(it.localPath) }
            playlistItemDao.deleteAll()
        } else {
            existing.values
                .filter { it.creativeId !in incoming }
                .forEach { removeLocalFile(it.localPath) }
            playlistItemDao.deleteNotIn(incoming.keys.toList())
        }

        appPreferences.setManifestVersion(manifest.manifestVersion)
    }.onFailure { error ->
        // Only a server-confirmed 401 (DeviceApiError.Unauthorized) ever
        // touches the device identity — a missing local key
        // (CredentialUnavailable) never does, since it was never actually
        // rejected by the server. Delegated to DeviceRepository (via
        // [deviceIdentity]) so the recovery logic lives in exactly one
        // place instead of being duplicated across every sync class.
        if (error is DeviceApiError.Unauthorized) {
            deviceIdentity.handleUnauthorizedDeviceKey()
        }
    }

    private suspend fun downloadOne(item: ManifestPlaylistItem, downloadUrl: String) {
        playlistItemDao.updateStatus(
            item.creativeId, PlaylistItemEntity.STATUS_DOWNLOADING, null, null,
            System.currentTimeMillis(),
        )

        if (!hasEnoughFreeSpace()) {
            playlistItemDao.updateStatus(
                item.creativeId, PlaylistItemEntity.STATUS_FAILED, null,
                "insufficient_storage", System.currentTimeMillis(),
            )
            return
        }

        val finalFile = File(mediaDir, "${item.creativeId}.${extensionFor(item.mimeType)}")
        val tmpFile = File(mediaDir, "${item.creativeId}.tmp")

        try {
            withContext(Dispatchers.IO) { apiClient.downloadTo(downloadUrl, tmpFile) }

            if (item.fileSizeBytes != null && tmpFile.length() != item.fileSizeBytes) {
                error("size_mismatch")
            }
            if (item.sha256 != null && sha256Of(tmpFile) != item.sha256) {
                error("hash_mismatch")
            }
            if (finalFile.exists()) finalFile.delete()
            check(tmpFile.renameTo(finalFile)) { "rename_failed" }

            playlistItemDao.updateStatus(
                item.creativeId, PlaylistItemEntity.STATUS_READY, finalFile.absolutePath, null,
                System.currentTimeMillis(),
            )
        } catch (e: Exception) {
            tmpFile.delete()
            playlistItemDao.updateStatus(
                item.creativeId, PlaylistItemEntity.STATUS_FAILED, null,
                e.message ?: e::class.simpleName ?: "download_failed",
                System.currentTimeMillis(),
            )
        }
    }

    private fun hasEnoughFreeSpace(): Boolean =
        StatFs(mediaDir.path).availableBytes > minFreeBytes

    private fun removeLocalFile(path: String?) {
        if (path != null) File(path).delete()
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DIGEST_BUFFER_SIZE)
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun extensionFor(mimeType: String) =
        when (mimeType.substringAfterLast('/')) {
            "jpeg" -> "jpg"
            else -> mimeType.substringAfterLast('/')
        }

    companion object {
        // Leaves an operational reserve so a fully packed grade never
        // fills the tablet completely.
        const val MIN_FREE_BYTES = 1_000_000_000L
        private const val DIGEST_BUFFER_SIZE = 8192
        // Below this, the local-expiry filter trusts the tablet's clock.
        // At or above it, something is badly wrong (dead RTC battery, no
        // NTP sync in months) and local expiry is suspended entirely
        // rather than risk wrongly blanking the screen.
        const val SEVERE_CLOCK_SKEW_SECONDS = 3600
    }
}

data class MediaPreparationStatus(
    val totalItems: Int = 0,
    val playableItems: Int = 0,
    val pendingItems: Int = 0,
    val downloadingItems: Int = 0,
    val failedItems: Int = 0,
    val diagnosticCode: String = "manifest_not_received",
) {
    val passengerTitle: String
        get() = when {
            playableItems > 0 -> "Conteúdo pronto"
            downloadingItems > 0 || pendingItems > 0 -> "Baixando conteúdo"
            failedItems > 0 -> "Não foi possível preparar o conteúdo"
            totalItems > 0 -> "Aguardando o horário da campanha"
            else -> "Aguardando programação"
        }

    val passengerMessage: String
        get() = when {
            downloadingItems > 0 || pendingItems > 0 -> "A reprodução começa automaticamente ao terminar."
            failedItems > 0 -> "O sistema tentará novamente na próxima sincronização."
            totalItems > 0 -> "A reprodução começa automaticamente no período programado."
            else -> "Configure e publique uma campanha no painel MAXCAR."
        }
}

internal fun summarizeMediaPreparation(
    items: List<PlaylistItemEntity>,
    playableItems: Int,
): MediaPreparationStatus {
    val pending = items.count { it.downloadStatus == PlaylistItemEntity.STATUS_PENDING }
    val downloading = items.count { it.downloadStatus == PlaylistItemEntity.STATUS_DOWNLOADING }
    val failed = items.count { it.downloadStatus == PlaylistItemEntity.STATUS_FAILED }
    val code = when {
        playableItems > 0 -> "ready"
        downloading > 0 -> "media_downloading"
        pending > 0 -> "media_pending"
        failed > 0 -> "media_download_failed"
        items.isNotEmpty() -> "outside_campaign_schedule"
        else -> "manifest_empty"
    }
    return MediaPreparationStatus(
        totalItems = items.size,
        playableItems = playableItems,
        pendingItems = pending,
        downloadingItems = downloading,
        failedItems = failed,
        diagnosticCode = code,
    )
}

private fun ManifestPlaylistItem.toPendingEntity(manifestVersion: String, now: Long) =
    PlaylistItemEntity(
        creativeId = creativeId,
        campaignId = campaignId,
        type = type,
        mimeType = mimeType,
        durationSeconds = durationSeconds,
        fileSizeBytes = fileSizeBytes,
        sha256 = sha256,
        position = position,
        manifestVersion = manifestVersion,
        downloadStatus = PlaylistItemEntity.STATUS_PENDING,
        localPath = null,
        lastError = null,
        updatedAt = now,
        startsAt = startsAt,
        endsAt = endsAt,
    )
