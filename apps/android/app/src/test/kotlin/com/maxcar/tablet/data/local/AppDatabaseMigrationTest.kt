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
 * without hand-transcribing seven tables' worth of column definitions.
 *
 * Uses [RemoteConfigEntityV9Fixture], not the live [RemoteConfigEntity],
 * for the same reason [AppDatabaseV9Fixture] does below: `remote_config`'s
 * shape at v8 and v9 is identical (only `media_quarantine` was added
 * between them), but the live entity has since evolved to v10's shape —
 * pointing this fixture at it would silently bake the not-yet-migrated
 * `maintenancePinHashVersion` column into what's supposed to be a pure v8
 * snapshot. */
@Database(
    entities = [
        DeviceStateEntity::class,
        RemoteConfigEntityV9Fixture::class,
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

/** The pre-MAX-013 shape of `remote_config` — no `maintenancePinHashVersion`
 * column — used only to seed a realistic version-9 database file for
 * [AppDatabaseMigrationTest]'s 9-to-10 case. */
@androidx.room.Entity(tableName = "remote_config")
internal data class RemoteConfigEntityV9Fixture(
    @androidx.room.PrimaryKey val id: Int = 0,
    val heartbeatIntervalSeconds: Int,
    val syncIntervalSeconds: Int,
    val kioskEnabled: Boolean,
    val loggingLevel: String,
    val configVersion: Int,
    val updatedAt: Long,
    val maintenancePinHash: String? = null,
    val maintenancePinSalt: String? = null,
    val maintenanceTimeoutSeconds: Int = 300,
)

@androidx.room.Dao
internal interface RemoteConfigV9FixtureDao {
    @androidx.room.Insert(onConflict = androidx.room.OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: RemoteConfigEntityV9Fixture)
}

/** A byte-for-byte mirror of [AppDatabase] as it existed at version 9 (every
 * entity through [MediaQuarantineEntity], but the pre-MAX-013 `remote_config`
 * shape) — same rationale as [AppDatabaseV8Fixture]. */
@Database(
    entities = [
        DeviceStateEntity::class,
        RemoteConfigEntityV9Fixture::class,
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
internal abstract class AppDatabaseV9Fixture : RoomDatabase() {
    abstract fun deviceStateDao(): DeviceStateDao
    abstract fun remoteConfigV9FixtureDao(): RemoteConfigV9FixtureDao
}

/** The pre-MAX-014 shape of `remote_config` — has `maintenancePinHashVersion`
 * (MAX-013) but none of the `latestApk*` OTA columns yet — used only to
 * seed a realistic version-10 database file for
 * [AppDatabaseMigrationTest]'s 10-to-11 case. */
@androidx.room.Entity(tableName = "remote_config")
internal data class RemoteConfigEntityV10Fixture(
    @androidx.room.PrimaryKey val id: Int = 0,
    val heartbeatIntervalSeconds: Int,
    val syncIntervalSeconds: Int,
    val kioskEnabled: Boolean,
    val loggingLevel: String,
    val configVersion: Int,
    val updatedAt: Long,
    val maintenancePinHash: String? = null,
    val maintenancePinSalt: String? = null,
    val maintenancePinHashVersion: Int = 1,
    val maintenanceTimeoutSeconds: Int = 300,
)

@androidx.room.Dao
internal interface RemoteConfigV10FixtureDao {
    @androidx.room.Insert(onConflict = androidx.room.OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: RemoteConfigEntityV10Fixture)
}

/** A byte-for-byte mirror of [AppDatabase] as it existed at version 10 —
 * same rationale as [AppDatabaseV8Fixture]/[AppDatabaseV9Fixture]. */
@Database(
    entities = [
        DeviceStateEntity::class,
        RemoteConfigEntityV10Fixture::class,
        PendingEventEntity::class,
        PlaylistItemEntity::class,
        PlaybackEventEntity::class,
        GeoRuleEntity::class,
        GeofenceEventEntity::class,
        MediaQuarantineEntity::class,
    ],
    version = 10,
    exportSchema = false,
)
internal abstract class AppDatabaseV10Fixture : RoomDatabase() {
    abstract fun deviceStateDao(): DeviceStateDao
    abstract fun remoteConfigV10FixtureDao(): RemoteConfigV10FixtureDao
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
            .addMigrations(AppDatabase.MIGRATION_8_9, AppDatabase.MIGRATION_9_10, AppDatabase.MIGRATION_10_11)
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

    /**
     * MAX-013: proves [AppDatabase.MIGRATION_9_10] preserves an already-set
     * legacy PIN hash — a device on the field that already has one cached
     * must not have it silently reset by this update, and must correctly
     * default the new hash-version column to 1 (legacy) so
     * [com.maxcar.tablet.kiosk.PinValidator] keeps validating it exactly as
     * before, until the next config fetch reports v2.
     */
    @Test
    fun `migrating from version 9 preserves the cached PIN hash and defaults its version to legacy`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dbFile = File.createTempFile("migration-test-${System.nanoTime()}", ".db")
        dbFile.delete()

        val v9 = Room.databaseBuilder(context, AppDatabaseV9Fixture::class.java, dbFile.path).build()
        runBlocking {
            v9.remoteConfigV9FixtureDao().upsert(
                RemoteConfigEntityV9Fixture(
                    heartbeatIntervalSeconds = 900,
                    syncIntervalSeconds = 3600,
                    kioskEnabled = true,
                    loggingLevel = "info",
                    configVersion = 5,
                    updatedAt = 999L,
                    maintenancePinHash = "existing-legacy-hash",
                    maintenancePinSalt = "existing-salt",
                ),
            )
        }
        v9.close()

        val database = Room.databaseBuilder(context, AppDatabase::class.java, dbFile.path)
            .addMigrations(AppDatabase.MIGRATION_8_9, AppDatabase.MIGRATION_9_10, AppDatabase.MIGRATION_10_11)
            .build()
        try {
            runBlocking {
                val preserved = database.remoteConfigDao().get()
                assertEquals("existing-legacy-hash", preserved?.maintenancePinHash)
                assertEquals("existing-salt", preserved?.maintenancePinSalt)
                assertEquals(1, preserved?.maintenancePinHashVersion)
            }
        } finally {
            database.close()
        }

        dbFile.delete()
    }

    /**
     * MAX-014: proves [AppDatabase.MIGRATION_10_11] preserves the cached
     * config row (PIN hash included) and defaults every new `latestApk*`
     * column to null — a device on the field mid-cycle when this update
     * lands must not have its cached PIN silently reset, and must not
     * report a phantom OTA release until its next real config fetch.
     */
    @Test
    fun `migrating from version 10 preserves cached config and defaults OTA fields to null`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dbFile = File.createTempFile("migration-test-${System.nanoTime()}", ".db")
        dbFile.delete()

        val v10 = Room.databaseBuilder(context, AppDatabaseV10Fixture::class.java, dbFile.path).build()
        runBlocking {
            v10.remoteConfigV10FixtureDao().upsert(
                RemoteConfigEntityV10Fixture(
                    heartbeatIntervalSeconds = 900,
                    syncIntervalSeconds = 3600,
                    kioskEnabled = true,
                    loggingLevel = "info",
                    configVersion = 7,
                    updatedAt = 999L,
                    maintenancePinHash = "existing-bcrypt-hash",
                    maintenancePinHashVersion = 2,
                ),
            )
        }
        v10.close()

        val database = Room.databaseBuilder(context, AppDatabase::class.java, dbFile.path)
            .addMigrations(AppDatabase.MIGRATION_8_9, AppDatabase.MIGRATION_9_10, AppDatabase.MIGRATION_10_11)
            .build()
        try {
            runBlocking {
                val preserved = database.remoteConfigDao().get()
                assertEquals("existing-bcrypt-hash", preserved?.maintenancePinHash)
                assertEquals(2, preserved?.maintenancePinHashVersion)
                assertEquals(null, preserved?.latestApkVersionCode)
                assertEquals(null, preserved?.latestApkDownloadUrl)
            }
        } finally {
            database.close()
        }

        dbFile.delete()
    }
}
