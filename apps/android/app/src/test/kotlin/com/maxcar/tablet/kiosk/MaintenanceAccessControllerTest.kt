package com.maxcar.tablet.kiosk

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import at.favre.lib.crypto.bcrypt.BCrypt
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.repository.MaintenanceTempCodeVerifier
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

/** Never actually reaches the network — a fixed answer for whatever the
 * test wants "the remote temporary code check" to report, so this suite
 * never needs a real [com.maxcar.tablet.data.repository.DeviceRepository]. */
private class FakeTempCodeVerifier(private val validCode: String? = null) : MaintenanceTempCodeVerifier {
    var lastCheckedCode: String? = null
    override suspend fun verifyMaintenanceTempCode(code: String): Boolean {
        lastCheckedCode = code
        return code == validCode
    }
}

@RunWith(RobolectricTestRunner::class)
class MaintenanceAccessControllerTest {

    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var tempCodeVerifier: FakeTempCodeVerifier
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
        tempCodeVerifier = FakeTempCodeVerifier()
        controller = MaintenanceAccessController(db.remoteConfigDao(), appPreferences, tempCodeVerifier)
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** MAX-013's current scheme: bcrypt, self-contained, version 2 — see
     * PinValidator. */
    private suspend fun seedBcryptPin(pin: String) {
        db.remoteConfigDao().upsert(
            RemoteConfigEntity.defaults().copy(
                maintenancePinHash = BCrypt.withDefaults().hashToString(12, pin.toCharArray()),
                maintenancePinSalt = null,
                maintenancePinHashVersion = 2,
            ),
        )
    }

    private suspend fun seedLegacySha256Pin(pin: String, salt: String = "fixed-salt") {
        db.remoteConfigDao().upsert(
            RemoteConfigEntity.defaults().copy(
                maintenancePinHash = sha256Hex(pin + salt),
                maintenancePinSalt = salt,
                maintenancePinHashVersion = 1,
            ),
        )
    }

    @Test
    fun `no PIN configured and no matching temp code is reported explicitly, never treated as unlocked`() = runTest {
        val result = controller.attemptUnlock("123456")
        assertEquals(UnlockResult.NoPinConfigured, result)
    }

    @Test
    fun `the correct bcrypt PIN unlocks and resets any prior attempt count`() = runTest {
        seedBcryptPin("135790")
        repeat(2) { controller.attemptUnlock("000000") } // two wrong attempts first

        val result = controller.attemptUnlock("135790")

        assertEquals(UnlockResult.Success, result)
        assertEquals(0, appPreferences.pinAttemptCountSnapshot())
    }

    @Test
    fun `a legacy v1 sha256 PIN still validates until rotated`() = runTest {
        seedLegacySha256Pin("135790")

        val result = controller.attemptUnlock("135790")

        assertEquals(UnlockResult.Success, result)
    }

    @Test
    fun `a remote temporary code unlocks even when it doesn't match the permanent PIN`() = runTest {
        seedBcryptPin("135790")
        tempCodeVerifier = FakeTempCodeVerifier(validCode = "246810")
        controller = MaintenanceAccessController(db.remoteConfigDao(), appPreferences, tempCodeVerifier)

        val result = controller.attemptUnlock("246810")

        assertEquals(UnlockResult.Success, result)
        assertEquals("246810", tempCodeVerifier.lastCheckedCode)
    }

    @Test
    fun `a temp code works even with no permanent PIN configured at all`() = runTest {
        tempCodeVerifier = FakeTempCodeVerifier(validCode = "246810")
        controller = MaintenanceAccessController(db.remoteConfigDao(), appPreferences, tempCodeVerifier)

        val result = controller.attemptUnlock("246810")

        assertEquals(UnlockResult.Success, result)
    }

    @Test
    fun `a wrong PIN reports the remaining attempts before lockout`() = runTest {
        seedBcryptPin("135790")

        val result = controller.attemptUnlock("000000")

        assertTrue(result is UnlockResult.WrongPin)
        assertEquals(
            MaintenanceAccessController.MAX_ATTEMPTS - 1,
            (result as UnlockResult.WrongPin).remainingAttempts,
        )
    }

    @Test
    fun `reaching the attempt limit locks out further tries, including a correct PIN`() = runTest {
        seedBcryptPin("135790")

        repeat(MaintenanceAccessController.MAX_ATTEMPTS) { controller.attemptUnlock("000000") }
        val lockedResult = controller.attemptUnlock("135790")

        assertTrue(lockedResult is UnlockResult.LockedOut)
    }

    @Test
    fun `a locked-out state persists across controller instances (survives an app restart)`() = runTest {
        seedBcryptPin("135790")
        repeat(MaintenanceAccessController.MAX_ATTEMPTS) { controller.attemptUnlock("000000") }

        val freshController = MaintenanceAccessController(db.remoteConfigDao(), appPreferences, tempCodeVerifier)
        val result = freshController.attemptUnlock("135790")

        assertTrue(result is UnlockResult.LockedOut)
    }
}
