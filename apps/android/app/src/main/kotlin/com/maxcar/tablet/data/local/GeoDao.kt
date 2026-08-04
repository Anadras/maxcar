package com.maxcar.tablet.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface GeoRuleDao {
    @Upsert
    suspend fun upsertAll(rules: List<GeoRuleEntity>)

    @Query("SELECT * FROM geo_rules ORDER BY priority DESC")
    fun observeAll(): Flow<List<GeoRuleEntity>>

    /** What [com.maxcar.tablet.geo.GeoEngine] evaluates against the current
     * location: only fully downloaded, validated GEO creatives — the exact
     * same "READY only" rule [PlaylistItemDao.observeReady] applies to the
     * REGULAR grade. */
    @Query("SELECT * FROM geo_rules WHERE downloadStatus = '${GeoRuleEntity.STATUS_READY}'")
    fun observeReady(): Flow<List<GeoRuleEntity>>

    @Query("SELECT * FROM geo_rules ORDER BY geofenceId ASC")
    suspend fun getAll(): List<GeoRuleEntity>

    @Query("SELECT * FROM geo_rules WHERE geofenceId = :geofenceId")
    suspend fun get(geofenceId: String): GeoRuleEntity?

    @Query(
        "UPDATE geo_rules SET downloadStatus = :status, localPath = :localPath, lastError = :lastError, updatedAt = :updatedAt WHERE geofenceId = :geofenceId",
    )
    suspend fun updateStatus(
        geofenceId: String,
        status: String,
        localPath: String?,
        lastError: String?,
        updatedAt: Long,
    )

    /** Persists the cooldown clock so it survives a restart/reboot
     * (MAX-008 item 15) — written the moment a GEO creative actually starts
     * playing, never on mere geofence entry. */
    @Query("UPDATE geo_rules SET lastTriggeredAtMillis = :triggeredAtMillis WHERE geofenceId = :geofenceId")
    suspend fun recordTriggered(geofenceId: String, triggeredAtMillis: Long)

    @Query("SELECT COUNT(*) FROM geo_rules WHERE downloadStatus = '${GeoRuleEntity.STATUS_READY}'")
    suspend fun countReady(): Int

    /** Same atomic-swap rule as [PlaylistItemDao.deleteNotIn]: only called
     * after the replacement rule set has been fully processed. An empty
     * [keepGeofenceIds] means "delete everything". */
    @Query("DELETE FROM geo_rules WHERE geofenceId NOT IN (:keepGeofenceIds)")
    suspend fun deleteNotIn(keepGeofenceIds: List<String>)

    @Query("DELETE FROM geo_rules")
    suspend fun deleteAll()
}

@Dao
interface GeofenceEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: GeofenceEventEntity)

    @Query("SELECT * FROM geofence_events ORDER BY createdAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int = 20): List<GeofenceEventEntity>

    @Query("SELECT COUNT(*) FROM geofence_events")
    suspend fun count(): Int

    @Query("DELETE FROM geofence_events WHERE clientEventId = :clientEventId")
    suspend fun delete(clientEventId: String)

    @Query("UPDATE geofence_events SET attemptCount = attemptCount + 1 WHERE clientEventId = :clientEventId")
    suspend fun recordAttempt(clientEventId: String)

    /** Bounds the queue: a tablet offline for a very long stretch can't
     * grow this table without limit — same retention rule as
     * [PlaybackEventDao.pruneOlderThan]. */
    @Query("DELETE FROM geofence_events WHERE createdAt < :olderThan")
    suspend fun pruneOlderThan(olderThan: Long)
}
