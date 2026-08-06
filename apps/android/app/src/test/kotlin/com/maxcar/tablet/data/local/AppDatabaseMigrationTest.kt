package com.maxcar.tablet.data.local

import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/** A byte-for-byte mirror of [AppDatabase] as it existed at version 8 (every
 * entity except [MediaQuarantineEntity]) — used only to generate a
 * realistic v8 database file for [AppDatabaseMigrationTest], since Room's
 * own schema generation is the only reliable way to get an exact match
 * without hand-transcribing seven tables' worth of column definitions. */
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
    version = 8,
    exportSchema = false,
)
internal abstract class AppDatabaseV8Fixture : RoomDatabase() {
    abstract fun deviceStateDao(): DeviceStateDao
}

/**
 * MAX-012: proves [AppDatabase.MIGRATION_8_9] is a real, data-preserving
 * migration rather than the destructive fallback every earlier version
 * bump relied on — a device already enrolled and mid-grade when it
 * receives this update must keep its identity and playlist, not silently
 * lose them the way `fallbackToDestructiveMigration` would.
 */
@RunWith(RobolectricTestRunner::class)
class AppDatabaseMigrationTest {

    @Test
    fun `migrating from version 8 preserves existing rows and adds the quarantine table`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dbFile = File.createTempFile("migration-test-${System.nanoTime()}", ".db")
        dbFile.delete()

        // Build a real version-8 database (Room-generated schema, not
        // hand-written SQL) and seed it exactly like a device that's been
        // enrolled and playing for a while would look.
        val v8 = Room.databaseBuilder(context, AppDatabaseV8Fixture::class.java, dbFile.path).build()
        runBlocking {
            v8.deviceStateDao().upsert(
                DeviceStateEntity(
                    deviceId = "f722ac2b-existing",
                    deviceCode = "TESTE01",
                    vehicleId = null,
                    vehicleCode = null,
                    keyId = "key-existing",
                    lastHeartbeatAt = null,
                    lastSyncAt = null,
                    updatedAt = 123L,
                ),
            )
        }
        v8.close()

        val database = Room.databaseBuilder(context, AppDatabase::class.java, dbFile.path)
            .addMigrations(AppDatabase.MIGRATION_8_9)
            .build()
        try {
            runBlocking {
                val preserved = database.deviceStateDao().get()
                assertEquals("f722ac2b-existing", preserved?.deviceId)
                assertEquals("TESTE01", preserved?.deviceCode)
                assertEquals("key-existing", preserved?.keyId)

                // The new table exists and is queryable — this would
                // throw if the migration hadn't created it.
                assertEquals(0, database.mediaQuarantineDao().countActive(System.currentTimeMillis()))
                database.mediaQuarantineDao().upsert(
                    MediaQuarantineEntity(
                        creativeId = "c1",
                        sha256 = "hash1",
                        consecutiveFailures = 2,
                        lastFailureReason = "watchdog_timeout",
                        lastFailureAtMillis = 100L,
                        quarantinedUntilMillis = System.currentTimeMillis() + 60_000L,
                    ),
                )
                assertEquals(1, database.mediaQuarantineDao().countActive(System.currentTimeMillis()))
            }
        } finally {
            database.close()
        }

        dbFile.delete()
    }
}
