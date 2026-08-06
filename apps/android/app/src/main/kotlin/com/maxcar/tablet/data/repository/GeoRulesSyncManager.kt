package com.maxcar.tablet.data.repository

import android.content.Context
import android.os.StatFs
import com.maxcar.tablet.data.local.GeoRuleDao
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.GeoRuleItem
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * The GEO twin of [MediaDownloadManager]: turns a fetched set of GEO rules
 * into validated, fully local creatives the offline
 * [com.maxcar.tablet.geo.GeoEngine] can play the instant a geofence fires —
 * same download/hash/atomic-swap discipline, same "no GEO streaming" rule
 * (MAX-008 item 24), just against `campaign_geofences` instead of a
 * playlist. Kept as its own class rather than folded into
 * [MediaDownloadManager] because the two cache different Room tables keyed
 * differently (creativeId vs geofenceId) and evolve independently — a GEO
 * rule can disappear (geofence deactivated) while its creative is still
 * used by a REGULAR campaign, and vice versa.
 */
class GeoRulesSyncManager(
    private val context: Context,
    private val apiClient: DeviceApiClient,
    private val deviceIdentity: DeviceIdentityProvider,
    private val geoRuleDao: GeoRuleDao,
    private val minFreeBytes: Long = MediaDownloadManager.MIN_FREE_BYTES,
) {
    private val mediaDir: File by lazy {
        File(context.filesDir, "geo_media").apply { mkdirs() }
    }

    /** What [com.maxcar.tablet.geo.GeoEngine] evaluates: only fully
     * downloaded, validated GEO rules. */
    val readyRules: Flow<List<GeoRuleEntity>> = geoRuleDao.observeReady()

    suspend fun readyCount(): Int = geoRuleDao.countReady()

    suspend fun sync(): Result<Unit> = runCatching {
        val keyId = deviceIdentity.currentKeyId()
            ?: throw DeviceApiError.CredentialUnavailable("No local device identity.")
        val response = withContext(Dispatchers.IO) { apiClient.getGeoRules(keyId) }
        val incoming = response.rules.associateBy { it.geofenceId }
        val existing = geoRuleDao.getAll().associateBy { it.geofenceId }
        val now = System.currentTimeMillis()

        val toUpsert = response.rules.map { rule ->
            existing[rule.geofenceId]
                ?.takeIf {
                    it.downloadStatus == GeoRuleEntity.STATUS_READY &&
                        it.sha256 == rule.sha256 &&
                        it.localPath?.let { path -> File(path).exists() } == true
                }
                // Unchanged and already on disk: keep the file and the
                // cooldown clock, just refresh the rule's own metadata
                // (radius/priority/cooldown can change server-side without
                // the creative itself changing).
                ?.copy(
                    latitude = rule.latitude,
                    longitude = rule.longitude,
                    radiusMeters = rule.radiusMeters,
                    priority = rule.priority,
                    cooldownSeconds = rule.cooldownSeconds,
                    playbackMode = rule.playbackMode,
                    maxWaitSeconds = rule.maxWaitSeconds,
                    rulesVersion = response.rulesVersion,
                    updatedAt = now,
                )
                ?: rule.toPendingEntity(response.rulesVersion, now)
        }
        geoRuleDao.upsertAll(toUpsert)

        for (rule in response.rules) {
            val row = geoRuleDao.get(rule.geofenceId) ?: continue
            if (row.downloadStatus == GeoRuleEntity.STATUS_READY) continue
            val downloadUrl = incoming[rule.geofenceId]?.downloadUrl ?: continue
            downloadOne(rule, downloadUrl)
        }

        // Atomic swap, same rule as MediaDownloadManager.sync: old files are
        // only removed after the new rule set is fully processed.
        if (incoming.isEmpty()) {
            existing.values.forEach { removeLocalFile(it.localPath) }
            geoRuleDao.deleteAll()
        } else {
            existing.values
                .filter { it.geofenceId !in incoming }
                .forEach { removeLocalFile(it.localPath) }
            geoRuleDao.deleteNotIn(incoming.keys.toList())
        }
    }.onFailure { error ->
        // Only a server-confirmed 401 touches the device identity — a
        // merely unusable local key (CredentialUnavailable) never does.
        if (error is DeviceApiError.Unauthorized) deviceIdentity.handleUnauthorizedDeviceKey()
    }

    private suspend fun downloadOne(rule: GeoRuleItem, downloadUrl: String) {
        geoRuleDao.updateStatus(
            rule.geofenceId, GeoRuleEntity.STATUS_DOWNLOADING, null, null,
            System.currentTimeMillis(),
        )

        if (!hasEnoughFreeSpace()) {
            geoRuleDao.updateStatus(
                rule.geofenceId, GeoRuleEntity.STATUS_FAILED, null,
                "insufficient_storage", System.currentTimeMillis(),
            )
            return
        }

        val finalFile = File(mediaDir, "${rule.geofenceId}.${extensionFor(rule.mimeType)}")
        val tmpFile = File(mediaDir, "${rule.geofenceId}.tmp")

        try {
            withContext(Dispatchers.IO) { apiClient.downloadTo(downloadUrl, tmpFile) }

            if (rule.fileSizeBytes != null && tmpFile.length() != rule.fileSizeBytes) {
                error("size_mismatch")
            }
            if (rule.sha256 != null && sha256Of(tmpFile) != rule.sha256) {
                error("hash_mismatch")
            }
            if (finalFile.exists()) finalFile.delete()
            check(tmpFile.renameTo(finalFile)) { "rename_failed" }

            geoRuleDao.updateStatus(
                rule.geofenceId, GeoRuleEntity.STATUS_READY, finalFile.absolutePath, null,
                System.currentTimeMillis(),
            )
        } catch (e: Exception) {
            tmpFile.delete()
            geoRuleDao.updateStatus(
                rule.geofenceId, GeoRuleEntity.STATUS_FAILED, null,
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

    private companion object {
        const val DIGEST_BUFFER_SIZE = 8192
    }
}

private fun GeoRuleItem.toPendingEntity(rulesVersion: String, now: Long) =
    GeoRuleEntity(
        geofenceId = geofenceId,
        campaignId = campaignId,
        creativeId = creativeId,
        establishmentId = establishmentId,
        latitude = latitude,
        longitude = longitude,
        radiusMeters = radiusMeters,
        priority = priority,
        cooldownSeconds = cooldownSeconds,
        playbackMode = playbackMode,
        maxWaitSeconds = maxWaitSeconds,
        type = type,
        mimeType = mimeType,
        durationSeconds = durationSeconds,
        fileSizeBytes = fileSizeBytes,
        sha256 = sha256,
        rulesVersion = rulesVersion,
        downloadStatus = GeoRuleEntity.STATUS_PENDING,
        localPath = null,
        lastError = null,
        lastTriggeredAtMillis = null,
        updatedAt = now,
    )
