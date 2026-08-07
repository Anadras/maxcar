package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * The server-controlled configuration this tablet last fetched
 * (GET /device-config). A single row, replaced whenever configVersion
 * changes; nothing here is decided locally.
 */
@Entity(tableName = "remote_config")
data class RemoteConfigEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val heartbeatIntervalSeconds: Int,
    val syncIntervalSeconds: Int,
    val kioskEnabled: Boolean,
    val loggingLevel: String,
    val configVersion: Int,
    val updatedAt: Long,
    // MAX-010: lets the tablet validate its admin PIN fully offline — see
    // com.maxcar.tablet.kiosk.PinValidator. Null means no PIN has been set
    // for this device yet, in which case maintenance access stays locked
    // rather than falling back to "no PIN required".
    val maintenancePinHash: String? = null,
    val maintenancePinSalt: String? = null,
    // MAX-013: version 1 = legacy sha256(pin||salt) (weak against offline
    // brute force, kept only so an already-set v1 PIN keeps validating
    // until an admin rotates it); version 2 = bcrypt, cost 12,
    // self-contained (maintenancePinSalt unused for v2 — bcrypt embeds
    // its own salt in the hash string). See PinValidator.
    val maintenancePinHashVersion: Int = 1,
    // MAX-011: how long a temporary kiosk exit (PIN-gated diagnostics entry
    // or a remote disable_kiosk_temporarily command) lasts before Lock Task
    // automatically re-engages — see AppPreferences.kioskSuspendedUntilMillis.
    val maintenanceTimeoutSeconds: Int = DEFAULT_MAINTENANCE_TIMEOUT_SECONDS,
    // MAX-014: the latest APK release offered to this device, if any —
    // see kiosk.ApkUpdateManager. All five null together means "nothing
    // currently offered", never a partial set (get_device_config's own
    // LEFT JOIN LATERAL guarantees this row-wise).
    val latestApkVersionCode: Int? = null,
    val latestApkVersionName: String? = null,
    val latestApkSha256: String? = null,
    val latestApkSizeBytes: Long? = null,
    val latestApkDownloadUrl: String? = null,
) {
    companion object {
        const val SINGLETON_ID = 0
        const val DEFAULT_MAINTENANCE_TIMEOUT_SECONDS = 300

        /** Used before the first successful config fetch ever completes. */
        fun defaults() = RemoteConfigEntity(
            heartbeatIntervalSeconds = 900,
            syncIntervalSeconds = 3600,
            kioskEnabled = false,
            loggingLevel = "info",
            configVersion = 0,
            updatedAt = 0,
        )
    }
}
