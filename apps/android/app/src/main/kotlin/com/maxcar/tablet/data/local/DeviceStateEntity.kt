package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A single row describing what this tablet currently knows about itself:
 * which backend device/vehicle it is, and when it last talked to the
 * server successfully. Overwritten in place; MAX-006 has no history of
 * device state, only the current snapshot.
 */
@Entity(tableName = "device_state")
data class DeviceStateEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val deviceId: String,
    val deviceCode: String,
    val vehicleId: String?,
    val vehicleCode: String?,
    val lastHeartbeatAt: String?,
    val lastSyncAt: String?,
    val updatedAt: Long,
) {
    companion object {
        const val SINGLETON_ID = 0
    }
}
