package com.maxcar.tablet.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A heartbeat (today, the only event type) that couldn't be delivered yet.
 * clientEventId is the same idempotency key sent to the server, so a retry
 * that finally lands after several failed attempts can never be recorded
 * twice — record_device_heartbeat() on the backend treats a repeated
 * clientEventId as a no-op.
 *
 * Retention is bounded by HeartbeatWorker, which drops anything older than
 * a fixed window rather than growing this table forever while the tablet
 * is offline for an extended period.
 */
@Entity(
    tableName = "pending_event",
    indices = [Index(value = ["clientEventId"], unique = true)],
)
data class PendingEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val clientEventId: String,
    val batteryLevel: Int?,
    val networkType: String,
    val storageFreeBytes: Long?,
    val appVersion: String,
    val deviceTimeMillis: Long,
    val createdAt: Long,
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
)
