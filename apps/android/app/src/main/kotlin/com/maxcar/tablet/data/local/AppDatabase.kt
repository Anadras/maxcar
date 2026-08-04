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
    version = 7,
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
                    // Room defaults to WAL: a write commits into a separate
                    // -wal file first and is only merged into the main .db
                    // file on a later checkpoint (by page-count threshold or
                    // clean connection close) — normally safe across a
                    // process death since the next connection replays the
                    // WAL, but a real pilot device demonstrated data an app
                    // process had just written and verified become
                    // unreadable to a *later* process within minutes,
                    // consistent with a WAL checkpoint never actually
                    // happening on that device before something (kill,
                    // storage cleanup) interfered with the -wal file.
                    // TRUNCATE writes each transaction straight into the
                    // main file, trading a little write throughput — not a
                    // concern at this app's write volume — for not
                    // depending on that checkpoint ever running.
                    .setJournalMode(RoomDatabase.JournalMode.TRUNCATE)
                    .build().also { instance = it }
            }
    }
}
