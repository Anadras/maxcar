package com.maxcar.tablet.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface MediaQuarantineDao {
    @Upsert
    suspend fun upsert(entity: MediaQuarantineEntity)

    @Query("SELECT * FROM media_quarantine WHERE creativeId = :creativeId")
    suspend fun get(creativeId: String): MediaQuarantineEntity?

    /** Everything the player/queue-filtering logic needs to know, reactive
     * so [com.maxcar.tablet.data.repository.MediaDownloadManager.readyPlaylist]
     * can exclude a newly-quarantined item without waiting for the next
     * manifest sync. */
    @Query("SELECT * FROM media_quarantine")
    fun observeAll(): Flow<List<MediaQuarantineEntity>>

    @Query("SELECT COUNT(*) FROM media_quarantine WHERE quarantinedUntilMillis IS NOT NULL AND quarantinedUntilMillis > :nowMillis")
    suspend fun countActive(nowMillis: Long): Int

    @Query("DELETE FROM media_quarantine WHERE creativeId = :creativeId")
    suspend fun clear(creativeId: String)

    /** A creative that comes back with a new hash is a genuinely different
     * file (item 11: "uma campanha com nova mídia válida não pode continuar
     * bloqueada") — called from the sync path whenever an incoming
     * manifest entry's hash no longer matches what's quarantined. */
    @Query("DELETE FROM media_quarantine WHERE creativeId = :creativeId AND (sha256 IS NULL OR sha256 != :newSha256)")
    suspend fun clearIfHashChanged(creativeId: String, newSha256: String?)
}
