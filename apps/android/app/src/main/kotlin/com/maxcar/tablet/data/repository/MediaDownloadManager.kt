package com.maxcar.tablet.data.repository

import android.content.Context
import android.os.StatFs
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.PlaylistItemDao
import com.maxcar.tablet.data.local.PlaylistItemEntity
import com.maxcar.tablet.data.local.TokenStore
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
    private val tokenStore: TokenStore,
    private val playlistItemDao: PlaylistItemDao,
    private val appPreferences: AppPreferences,
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
     * clock has moved past.
     *
     * That local-clock filter is skipped entirely when the last known
     * clock skew is severe (`SEVERE_CLOCK_SKEW_SECONDS`): a tablet whose
     * clock is badly wrong shouldn't cut content it can't actually judge
     * the validity of — better to keep playing than to wrongly go dark
     * because of a bad clock. A small/unknown skew is trusted; see
     * [AppPreferences.clockSkewSeconds] for how it's measured. */
    val readyPlaylist: Flow<List<PlaylistItemEntity>> =
        combine(playlistItemDao.observeReady(), appPreferences.clockSkewSeconds) { items, skewSeconds ->
            val clockIsTrustworthy = skewSeconds == null || abs(skewSeconds) < SEVERE_CLOCK_SKEW_SECONDS
            if (!clockIsTrustworthy) return@combine items
            val now = System.currentTimeMillis()
            items.filter { it.isCurrentlyValid(now) }
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
        val token = tokenStore.readToken()
            ?: throw DeviceApiError.Unauthorized("Not enrolled.")
        val manifest = withContext(Dispatchers.IO) { apiClient.getManifest(token) }
        val incoming = manifest.playlist.associateBy { it.creativeId }
        val existing = playlistItemDao.getAll().associateBy { it.creativeId }
        val now = System.currentTimeMillis()

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
            val downloadUrl = incoming[item.creativeId]?.downloadUrl ?: continue
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
        // Duplicated from DeviceRepository.handleRevocation rather than
        // shared across the two classes: a network failure must never
        // clear the credential, only an explicit 401 — the same rule, but
        // media sync has no other reason to depend on DeviceRepository.
        if (error is DeviceApiError.Unauthorized) {
            tokenStore.clear()
            appPreferences.setEnrolled(false)
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
