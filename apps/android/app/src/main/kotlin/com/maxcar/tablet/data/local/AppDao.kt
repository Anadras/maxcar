package com.maxcar.tablet.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface DeviceStateDao {
    @Upsert
    suspend fun upsert(state: DeviceStateEntity)

    @Query("SELECT * FROM device_state WHERE id = ${DeviceStateEntity.SINGLETON_ID}")
    fun observe(): Flow<DeviceStateEntity?>

    @Query("SELECT * FROM device_state WHERE id = ${DeviceStateEntity.SINGLETON_ID}")
    suspend fun get(): DeviceStateEntity?

    @Query("DELETE FROM device_state")
    suspend fun clear()
}

@Dao
interface RemoteConfigDao {
    @Upsert
    suspend fun upsert(config: RemoteConfigEntity)

    @Query("SELECT * FROM remote_config WHERE id = ${RemoteConfigEntity.SINGLETON_ID}")
    fun observe(): Flow<RemoteConfigEntity?>

    @Query("SELECT * FROM remote_config WHERE id = ${RemoteConfigEntity.SINGLETON_ID}")
    suspend fun get(): RemoteConfigEntity?
}

@Dao
interface DeviceCredentialDao {
    @Upsert
    suspend fun upsert(entity: DeviceCredentialEntity)

    @Query("SELECT * FROM device_credential WHERE id = ${DeviceCredentialEntity.SINGLETON_ID}")
    suspend fun get(): DeviceCredentialEntity?

    @Query("DELETE FROM device_credential")
    suspend fun clear()
}

@Dao
interface PendingEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: PendingEventEntity): Long

    @Query("SELECT * FROM pending_event ORDER BY createdAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int = 20): List<PendingEventEntity>

    @Query("SELECT COUNT(*) FROM pending_event")
    suspend fun count(): Int

    @Delete
    suspend fun delete(event: PendingEventEntity)

    @Query(
        "UPDATE pending_event SET attemptCount = attemptCount + 1, lastAttemptAt = :now WHERE id = :id",
    )
    suspend fun recordAttempt(id: Long, now: Long)

    /** Bounds the queue: drop anything older than [olderThan] so an
     * extended offline period can't grow this table without limit. */
    @Query("DELETE FROM pending_event WHERE createdAt < :olderThan")
    suspend fun pruneOlderThan(olderThan: Long)
}
