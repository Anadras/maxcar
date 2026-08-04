package com.maxcar.tablet.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PlaylistItemDao {
    @Upsert
    suspend fun upsertAll(items: List<PlaylistItemEntity>)

    @Query("SELECT * FROM playlist_items ORDER BY position ASC")
    fun observeAll(): Flow<List<PlaylistItemEntity>>

    /** What the player actually reads: only fully downloaded, validated
     * items, in grade order. */
    @Query(
        "SELECT * FROM playlist_items WHERE downloadStatus = '${PlaylistItemEntity.STATUS_READY}' ORDER BY position ASC",
    )
    fun observeReady(): Flow<List<PlaylistItemEntity>>

    @Query("SELECT * FROM playlist_items ORDER BY position ASC")
    suspend fun getAll(): List<PlaylistItemEntity>

    @Query("SELECT * FROM playlist_items WHERE creativeId = :creativeId")
    suspend fun get(creativeId: String): PlaylistItemEntity?

    @Query(
        "UPDATE playlist_items SET downloadStatus = :status, localPath = :localPath, lastError = :lastError, updatedAt = :updatedAt WHERE creativeId = :creativeId",
    )
    suspend fun updateStatus(
        creativeId: String,
        status: String,
        localPath: String?,
        lastError: String?,
        updatedAt: Long,
    )

    @Query(
        "SELECT COUNT(*) FROM playlist_items WHERE downloadStatus = '${PlaylistItemEntity.STATUS_READY}'",
    )
    suspend fun countReady(): Int

    /** Deletes rows that no longer belong to the current grade — only
     * called after the replacement grade is fully downloaded and
     * validated, per the atomic-swap rule in ANDROID_MEDIA_CACHE.md. An
     * empty [keepCreativeIds] means "delete everything" (SQLite's `NOT IN
     * ()` never matches), which the caller must special-case. */
    @Query("DELETE FROM playlist_items WHERE creativeId NOT IN (:keepCreativeIds)")
    suspend fun deleteNotIn(keepCreativeIds: List<String>)

    @Query("DELETE FROM playlist_items")
    suspend fun deleteAll()
}

@Dao
interface PlaybackEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: PlaybackEventEntity)

    @Query("SELECT * FROM playback_events ORDER BY createdAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int = 20): List<PlaybackEventEntity>

    @Query("SELECT COUNT(*) FROM playback_events")
    suspend fun count(): Int

    @Query("DELETE FROM playback_events WHERE clientEventId = :clientEventId")
    suspend fun delete(clientEventId: String)

    @Query("UPDATE playback_events SET attemptCount = attemptCount + 1 WHERE clientEventId = :clientEventId")
    suspend fun recordAttempt(clientEventId: String)

    /** Bounds the queue: a tablet offline for a very long stretch can't
     * grow this table without limit. */
    @Query("DELETE FROM playback_events WHERE createdAt < :olderThan")
    suspend fun pruneOlderThan(olderThan: Long)
}
