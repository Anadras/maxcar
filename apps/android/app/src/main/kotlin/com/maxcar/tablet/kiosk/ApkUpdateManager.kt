package com.maxcar.tablet.kiosk

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.remote.DeviceApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import kotlin.coroutines.resume

/** MAX-014 items 6-7: remote APK updates + their client-side "rollback
 * lógico". The device is Device Owner (see docs/architecture/ANDROID_KIOSK.md)
 * — the one privilege that lets [PackageInstaller] silently update this
 * app's own package with no user-facing confirmation, the same way
 * `adb install -r` never prompts either. Never touches a different
 * package, never grants itself the ability to install anything it
 * wasn't explicitly told to via a super_admin-published, checksum-
 * verified release. */
sealed class ApkUpdateOutcome {
    data object NoUpdateAvailable : ApkUpdateOutcome()
    data object AlreadyUpToDate : ApkUpdateOutcome()
    data class Applied(val versionCode: Int) : ApkUpdateOutcome()
    data class Failed(val reason: String) : ApkUpdateOutcome()
}

/** Narrow interface around the actual platform install call — same pattern
 * as [com.maxcar.tablet.data.repository.MaintenanceTempCodeVerifier]: keeps
 * [ApkUpdateManager]'s own decision logic (is this newer? does the
 * checksum match? back up first) unit-testable with a fake, without a real
 * Device Owner-privileged install ever running in a JVM test. */
fun interface PackageInstallerGateway {
    suspend fun install(apkFile: File): Result<Unit>
}

class RealPackageInstallerGateway(private val context: Context) : PackageInstallerGateway {
    override suspend fun install(apkFile: File): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                // API 31+: explicit, since this app's minSdk (30) predates
                // it — on 30 itself, a Device Owner app's install already
                // proceeds without a user prompt without needing this call
                // at all; this is belt-and-suspenders on newer OS versions
                // where the platform started requiring it to be explicit.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
            }
            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            session.use {
                apkFile.inputStream().use { input ->
                    it.openWrite("update", 0, apkFile.length()).use { output ->
                        input.copyTo(output)
                        it.fsync(output)
                    }
                }
                val intent = Intent(context, ApkInstallResultReceiver::class.java)
                val pendingIntent = android.app.PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    intent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE,
                )
                suspendCancellableCoroutine { continuation ->
                    ApkInstallResultReceiver.awaiting[sessionId] = continuation
                    it.commit(pendingIntent.intentSender)
                }
            }
        }
    }
}

/** [PackageInstaller.commit] reports its outcome via a broadcast, not a
 * direct callback — this receiver bridges that back to the suspend call
 * that's waiting on it. Registered in the manifest (not dynamically) so it
 * exists to receive the result even if the process that started the
 * install gets killed before the install finishes. */
class ApkInstallResultReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val continuation = awaiting.remove(sessionId) ?: return
        if (status == PackageInstaller.STATUS_SUCCESS) {
            continuation.resume(Unit)
        } else {
            continuation.cancel(IllegalStateException("Install failed (status=$status): $message"))
        }
    }

    companion object {
        val awaiting = java.util.concurrent.ConcurrentHashMap<Int, kotlinx.coroutines.CancellableContinuation<Unit>>()
    }
}

class ApkUpdateManager(
    private val context: Context,
    private val apiClient: DeviceApiClient,
    private val remoteConfigDao: RemoteConfigDao,
    private val appPreferences: AppPreferences,
    private val packageInstaller: PackageInstallerGateway,
    // Injected rather than read from BuildConfig directly so a test can
    // exercise "already up to date" / "genuinely newer" without needing a
    // real build variant's compiled-in version.
    private val currentVersionCode: Int,
    // Overridable so a test can back this with a real temp file instead of
    // PackageManager's ApplicationInfo.sourceDir, which under Robolectric
    // doesn't reliably point at a real, readable file on disk. AppContainer
    // never passes this, so production always uses the default.
    private val currentApkSourcePathProvider: () -> String = {
        context.packageManager.getApplicationInfo(context.packageName, 0).sourceDir
    },
) {
    private val updateDir: File by lazy { File(context.filesDir, "updates").apply { mkdirs() } }

    /**
     * One check-and-apply attempt, called as [com.maxcar.tablet.sync.SyncCoordinator]'s
     * final, lowest-priority step — the most disruptive action available
     * (replacing the running app's own code) only ever happens after every
     * other, less invasive sync step has already completed. Never throws;
     * every failure is caught and reported the same way every other
     * best-effort sync step is.
     */
    suspend fun checkAndApply(): ApkUpdateOutcome {
        val config = remoteConfigDao.get() ?: return ApkUpdateOutcome.NoUpdateAvailable
        val versionCode = config.latestApkVersionCode
        val downloadUrl = config.latestApkDownloadUrl
        val expectedSha256 = config.latestApkSha256
        if (versionCode == null || downloadUrl == null || expectedSha256 == null) {
            return ApkUpdateOutcome.NoUpdateAvailable
        }
        if (versionCode <= currentVersionCode) return ApkUpdateOutcome.AlreadyUpToDate

        return runCatching {
            val apkFile = File(updateDir, "update-$versionCode.apk")
            withContext(Dispatchers.IO) { apiClient.downloadTo(downloadUrl, apkFile) }

            val actualSha256 = sha256Of(apkFile)
            if (actualSha256 != expectedSha256) {
                apkFile.delete()
                return ApkUpdateOutcome.Failed("sha256_mismatch")
            }

            val backupPath = backupCurrentApk()
            appPreferences.setPendingUpdate(versionCode, System.currentTimeMillis(), backupPath)

            val installResult = packageInstaller.install(apkFile)
            apkFile.delete()
            installResult.fold(
                onSuccess = { ApkUpdateOutcome.Applied(versionCode) },
                onFailure = {
                    // The install itself never took — nothing to roll back
                    // from, since the previous version is still what's
                    // running right now.
                    appPreferences.clearPendingUpdate()
                    ApkUpdateOutcome.Failed(it.message ?: "install_failed")
                },
            )
        }.getOrElse { ApkUpdateOutcome.Failed(it.message ?: "update_failed") }
    }

    /** Copies the currently-*running* APK (not the one about to be
     * installed) to a local backup file — the exact bytes [ApkRollback]
     * reinstalls if the new version never proves itself healthy. */
    private fun backupCurrentApk(): String {
        val currentSourceDir = currentApkSourcePathProvider()
        val backupFile = File(updateDir, "rollback.apk")
        File(currentSourceDir).copyTo(backupFile, overwrite = true)
        return backupFile.absolutePath
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
