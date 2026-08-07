package com.maxcar.tablet.kiosk

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.maxcar.tablet.data.local.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID

/**
 * MAX-014 item 7: proves [ApkRollback]'s own decision logic (has enough
 * time passed? does a backup exist? clear the marker only when there's
 * genuinely nothing left to retry) against a fake [PackageInstallerGateway] —
 * see [ApkUpdateManagerTest]'s class doc for why the real platform install
 * call itself is never exercised in a JVM test.
 */
@RunWith(RobolectricTestRunner::class)
class ApkRollbackTest {

    private lateinit var appPreferences: AppPreferences
    private var clockMillis = 1_000_000L

    @Before
    fun setUp() {
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        appPreferences = AppPreferences(
            PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.Unconfined)) { prefsFile },
        )
    }

    private fun rollback(installer: PackageInstallerGateway) = ApkRollback(
        appPreferences = appPreferences,
        packageInstaller = installer,
        now = { clockMillis },
    )

    @Test
    fun `nothing pending reports NothingPending without touching the installer`() = runTest {
        var installCalled = false
        val outcome = rollback(PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndRollbackIfNeeded()

        assertEquals(RollbackOutcome.NothingPending, outcome)
        assertTrue(!installCalled)
    }

    @Test
    fun `a pending update still within its health-check window is left alone`() = runTest {
        appPreferences.setPendingUpdate(versionCode = 5, setAtMillis = clockMillis, previousApkBackupPath = "/tmp/irrelevant.apk")
        clockMillis += ApkRollback.HEALTH_CHECK_TIMEOUT_MS - 1000

        var installCalled = false
        val outcome = rollback(PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndRollbackIfNeeded()

        assertEquals(RollbackOutcome.StillWaiting, outcome)
        assertTrue(!installCalled)
        // Still pending — a later check should get another chance.
        assertTrue(appPreferences.pendingUpdateSnapshot() != null)
    }

    @Test
    fun `a missing backup file clears the marker without attempting an install`() = runTest {
        appPreferences.setPendingUpdate(
            versionCode = 5, setAtMillis = clockMillis,
            previousApkBackupPath = "/nonexistent/rollback.apk",
        )
        clockMillis += ApkRollback.HEALTH_CHECK_TIMEOUT_MS + 1000

        var installCalled = false
        val outcome = rollback(PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndRollbackIfNeeded()

        assertEquals(RollbackOutcome.NoBackupAvailable, outcome)
        assertTrue(!installCalled)
        assertNull(appPreferences.pendingUpdateSnapshot())
    }

    @Test
    fun `an update never confirmed healthy within the window is rolled back`() = runTest {
        val backupFile = File.createTempFile("rollback-${UUID.randomUUID()}", ".apk")
        backupFile.writeBytes("previous-good-apk".toByteArray())
        appPreferences.setPendingUpdate(versionCode = 5, setAtMillis = clockMillis, previousApkBackupPath = backupFile.absolutePath)
        clockMillis += ApkRollback.HEALTH_CHECK_TIMEOUT_MS + 1000

        var installedFile: File? = null
        val outcome = rollback(PackageInstallerGateway { file ->
            installedFile = file
            Result.success(Unit)
        }).checkAndRollbackIfNeeded()

        assertEquals(RollbackOutcome.RolledBack, outcome)
        assertEquals(backupFile.absolutePath, installedFile?.absolutePath)
        assertNull(appPreferences.pendingUpdateSnapshot())
    }

    @Test
    fun `a failed rollback install keeps the marker so a later attempt can retry`() = runTest {
        val backupFile = File.createTempFile("rollback-${UUID.randomUUID()}", ".apk")
        backupFile.writeBytes("previous-good-apk".toByteArray())
        appPreferences.setPendingUpdate(versionCode = 5, setAtMillis = clockMillis, previousApkBackupPath = backupFile.absolutePath)
        clockMillis += ApkRollback.HEALTH_CHECK_TIMEOUT_MS + 1000

        val outcome = rollback(PackageInstallerGateway {
            Result.failure(IllegalStateException("session_error"))
        }).checkAndRollbackIfNeeded()

        assertTrue(outcome is RollbackOutcome.RollbackFailed)
        assertTrue(appPreferences.pendingUpdateSnapshot() != null)
    }

    @Test
    fun `confirming health (clearPendingUpdate) makes a later check a no-op`() = runTest {
        appPreferences.setPendingUpdate(versionCode = 5, setAtMillis = clockMillis, previousApkBackupPath = "/tmp/irrelevant.apk")
        // Simulates SyncCoordinator's own confirmation on a successful
        // post-update heartbeat.
        appPreferences.clearPendingUpdate()
        clockMillis += ApkRollback.HEALTH_CHECK_TIMEOUT_MS + 1000

        var installCalled = false
        val outcome = rollback(PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndRollbackIfNeeded()

        assertEquals(RollbackOutcome.NothingPending, outcome)
        assertTrue(!installCalled)
    }
}
