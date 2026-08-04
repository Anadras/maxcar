package com.maxcar.tablet.kiosk

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.security.MessageDigest
import java.util.UUID

private fun sha256Hex(value: String) =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

@RunWith(RobolectricTestRunner::class)
class MaintenanceAccessControllerTest {

    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var controller: MaintenanceAccessController

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        val dataStore = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(Dispatchers.Unconfined),
        ) { prefsFile }
        appPreferences = AppPreferences(dataStore)
        controller = MaintenanceAccessController(db.remoteConfigDao(), appPreferences)
    }

    @After
    fun tearDown() {
        db.close()
    }

    private suspend fun seedPin(pin: String, salt: String = "fixed-salt") {
        db.remoteConfigDao().upsert(
            RemoteConfigEntity.defaults().copy(
                maintenancePinHash = sha256Hex(pin + salt),
                maintenancePinSalt = salt,
            ),
        )
    }

    @Test
    fun `no PIN configured is reported explicitly, never treated as unlocked`() = runTest {
        val result = controller.attemptUnlock("1234")
        assertEquals(UnlockResult.NoPinConfigured, result)
    }

    @Test
    fun `the correct PIN unlocks and resets any prior attempt count`() = runTest {
        seedPin("135790")
        repeat(2) { controller.attemptUnlock("000000") } // two wrong attempts first

        val result = controller.attemptUnlock("135790")

        assertEquals(UnlockResult.Success, result)
        assertEquals(0, appPreferences.pinAttemptCountSnapshot())
    }

    @Test
    fun `a wrong PIN reports the remaining attempts before lockout`() = runTest {
        seedPin("135790")

        val result = controller.attemptUnlock("000000")

        assertTrue(result is UnlockResult.WrongPin)
        assertEquals(
            MaintenanceAccessController.MAX_ATTEMPTS - 1,
            (result as UnlockResult.WrongPin).remainingAttempts,
        )
    }

    @Test
    fun `reaching the attempt limit locks out further tries, including a correct PIN`() = runTest {
        seedPin("135790")

        repeat(MaintenanceAccessController.MAX_ATTEMPTS) { controller.attemptUnlock("000000") }
        val lockedResult = controller.attemptUnlock("135790")

        assertTrue(lockedResult is UnlockResult.LockedOut)
    }

    @Test
    fun `a locked-out state persists across controller instances (survives an app restart)`() = runTest {
        seedPin("135790")
        repeat(MaintenanceAccessController.MAX_ATTEMPTS) { controller.attemptUnlock("000000") }

        val freshController = MaintenanceAccessController(db.remoteConfigDao(), appPreferences)
        val result = freshController.attemptUnlock("135790")

        assertTrue(result is UnlockResult.LockedOut)
    }
}
