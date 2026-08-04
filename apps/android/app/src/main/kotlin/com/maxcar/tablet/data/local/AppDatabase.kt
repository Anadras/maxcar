package com.maxcar.tablet.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        DeviceStateEntity::class,
        RemoteConfigEntity::class,
        PendingEventEntity::class,
        PlaylistItemEntity::class,
        PlaybackEventEntity::class,
        GeoRuleEntity::class,
        GeofenceEventEntity::class,
    ],
    version = 4,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun deviceStateDao(): DeviceStateDao
    abstract fun remoteConfigDao(): RemoteConfigDao
    abstract fun pendingEventDao(): PendingEventDao
    abstract fun playlistItemDao(): PlaylistItemDao
    abstract fun playbackEventDao(): PlaybackEventDao
    abstract fun geoRuleDao(): GeoRuleDao
    abstract fun geofenceEventDao(): GeofenceEventDao

    companion object {
        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "maxcar.db",
                )
                    // No migration path exists yet for this early-pilot
                    // schema; a version bump without one would otherwise
                    // crash on upgrade. Re-syncing the manifest after an
                    // update is cheap (the device already does it on every
                    // app open), so wiping local cache on schema change is
                    // an acceptable, documented tradeoff for now — revisit
                    // once the schema stabilizes and real migrations matter.
                    .fallbackToDestructiveMigration(dropAllTables = true)
                    .build().also { instance = it }
            }
    }
}
