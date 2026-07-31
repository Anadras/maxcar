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
) {
    companion object {
        const val SINGLETON_ID = 0

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
