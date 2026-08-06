package com.maxcar.tablet.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        DeviceStateEntity::class,
        RemoteConfigEntity::class,
        PendingEventEntity::class,
        PlaylistItemEntity::class,
        PlaybackEventEntity::class,
        GeoRuleEntity::class,
        GeofenceEventEntity::class,
        MediaQuarantineEntity::class,
    ],
    version = 9,
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
    abstract fun mediaQuarantineDao(): MediaQuarantineDao

    companion object {
        @Volatile
        private var instance: AppDatabase? = null

        /** MAX-012: the first *real* migration this app has ever needed —
         * every version bump before this one still went through
         * [fallbackToDestructiveMigration] below, which was an acceptable
         * tradeoff while the schema was pre-pilot. It no longer is: a
         * device already enrolled and playing in the field (identity in
         * [DeviceStateEntity], the current grade in [PlaylistItemEntity])
         * must never have that wiped by an app update alone — an update
         * is exactly the kind of thing `adb install -r` does routinely,
         * and this app's own operating rules forbid treating a routine
         * update like a factory reset. This migration only *adds* the new
         * [MediaQuarantineEntity] table; every existing row in every other
         * table is left untouched.
         */
        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `media_quarantine` (" +
                        "`creativeId` TEXT NOT NULL, `sha256` TEXT, " +
                        "`consecutiveFailures` INTEGER NOT NULL, `lastFailureReason` TEXT, " +
                        "`lastFailureAtMillis` INTEGER NOT NULL, `quarantinedUntilMillis` INTEGER, " +
                        "PRIMARY KEY(`creativeId`))",
                )
            }
        }

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "maxcar.db",
                )
                    .addMigrations(MIGRATION_8_9)
                    // Only reached for a jump this app has never shipped a
                    // real migration for (i.e. from before version 8) —
                    // see MIGRATION_8_9's own doc for why this pilot no
                    // longer treats that as an acceptable default going
                    // forward.
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
