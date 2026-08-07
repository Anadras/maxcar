package com.maxcar.tablet.kiosk

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.FakeDeviceKeyStore
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/**
 * MAX-014 items 6-7: proves [ApkUpdateManager]'s own decision logic
 * (newer-than-current? checksum verified? backup taken before install?)
 * against a fake [PackageInstallerGateway] — a real silent install needs
 * Device Owner privilege no JVM test can grant, so [PackageInstallerGateway]
 * exists precisely to make everything *around* that one platform call
 * verifiable without it.
 */
@RunWith(RobolectricTestRunner::class)
class ApkUpdateManagerTest {

    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var appPreferences: AppPreferences
    private lateinit var context: Context

    private val apkBytes = "fake-apk-bytes-for-testing".toByteArray()
    private val apkSha256 = MessageDigest.getInstance("SHA-256").digest(apkBytes)
        .joinToString("") { "%02x".format(it) }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val prefsFile = File.createTempFile("test-prefs-${UUID.randomUUID()}", ".preferences_pb")
        appPreferences = AppPreferences(
            PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.Unconfined)) { prefsFile },
        )
    }

    @After
    fun tearDown() {
        db.close()
        runCatching { server.shutdown() }
    }

    private suspend fun seedRelease(versionCode: Int, sha256: String = apkSha256) {
        db.remoteConfigDao().upsert(
            RemoteConfigEntity.defaults().copy(
                latestApkVersionCode = versionCode,
                latestApkVersionName = "0.$versionCode.0-pilot",
                latestApkSha256 = sha256,
                latestApkSizeBytes = apkBytes.size.toLong(),
                latestApkDownloadUrl = server.url("/release.apk").toString(),
            ),
        )
    }

    private fun manager(currentVersionCode: Int, installer: PackageInstallerGateway) = ApkUpdateManager(
        context = context,
        apiClient = DeviceApiClient(baseUrl = server.url("/").toString(), deviceKeyStore = FakeDeviceKeyStore()),
        remoteConfigDao = db.remoteConfigDao(),
        appPreferences = appPreferences,
        packageInstaller = installer,
        currentVersionCode = currentVersionCode,
        // A real, readable file standing in for the currently-running
        // APK's sourceDir — PackageManager's own ApplicationInfo.sourceDir
        // isn't reliably backed by a real file under Robolectric.
        currentApkSourcePathProvider = {
            File.createTempFile("fake-running-apk-${UUID.randomUUID()}", ".apk").apply {
                writeBytes("fake-currently-running-apk".toByteArray())
            }.absolutePath
        },
    )

    @Test
    fun `no release configured returns NoUpdateAvailable without touching the installer`() = runTest {
        var installCalled = false
        val outcome = manager(currentVersionCode = 1, installer = PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndApply()

        assertEquals(ApkUpdateOutcome.NoUpdateAvailable, outcome)
        assertTrue(!installCalled)
    }

    @Test
    fun `a release at or below the current version code is never applied`() = runTest {
        seedRelease(versionCode = 2)
        var installCalled = false
        val outcome = manager(currentVersionCode = 2, installer = PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndApply()

        assertEquals(ApkUpdateOutcome.AlreadyUpToDate, outcome)
        assertTrue(!installCalled)
    }

    @Test
    fun `a genuinely newer release is downloaded, verified and installed`() = runTest {
        seedRelease(versionCode = 3)
        server.enqueue(MockResponse().setBody(okio.Buffer().write(apkBytes)))
        var installedFile: File? = null
        val outcome = manager(currentVersionCode = 2, installer = PackageInstallerGateway { file ->
            installedFile = file
            Result.success(Unit)
        }).checkAndApply()

        assertEquals(ApkUpdateOutcome.Applied(3), outcome)
        assertTrue(installedFile != null)
    }

    @Test
    fun `a checksum mismatch is never installed`() = runTest {
        seedRelease(versionCode = 3, sha256 = "0".repeat(64))
        server.enqueue(MockResponse().setBody(okio.Buffer().write(apkBytes)))
        var installCalled = false
        val outcome = manager(currentVersionCode = 2, installer = PackageInstallerGateway {
            installCalled = true
            Result.success(Unit)
        }).checkAndApply()

        assertEquals(ApkUpdateOutcome.Failed("sha256_mismatch"), outcome)
        assertTrue(!installCalled)
        assertNull(appPreferences.pendingUpdateSnapshot())
    }

    @Test
    fun `a pending-update marker is set before install and survives a successful install`() = runTest {
        seedRelease(versionCode = 3)
        server.enqueue(MockResponse().setBody(okio.Buffer().write(apkBytes)))
        var pendingWasSetDuringInstall = false
        manager(currentVersionCode = 2, installer = PackageInstallerGateway {
            pendingWasSetDuringInstall = appPreferences.pendingUpdateSnapshot() != null
            Result.success(Unit)
        }).checkAndApply()

        assertTrue("pending-update marker must be set before the install call", pendingWasSetDuringInstall)
        val pending = appPreferences.pendingUpdateSnapshot()
        assertEquals(3, pending?.versionCode)
        assertTrue(File(pending!!.previousApkBackupPath).exists())
    }

    @Test
    fun `an install failure clears the pending-update marker — nothing to roll back from`() = runTest {
        seedRelease(versionCode = 3)
        server.enqueue(MockResponse().setBody(okio.Buffer().write(apkBytes)))
        val outcome = manager(currentVersionCode = 2, installer = PackageInstallerGateway {
            Result.failure(IllegalStateException("install_failed"))
        }).checkAndApply()

        assertTrue(outcome is ApkUpdateOutcome.Failed)
        assertNull(appPreferences.pendingUpdateSnapshot())
    }
}
