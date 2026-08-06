package com.maxcar.tablet

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.LocationForegroundService
import com.maxcar.tablet.kiosk.AdminReceiver
import com.maxcar.tablet.kiosk.MaintenanceAccessController
import com.maxcar.tablet.ui.enrollment.EnrollmentScreen
import com.maxcar.tablet.ui.enrollment.EnrollmentViewModel
import com.maxcar.tablet.ui.home.DeviceHomeScreen
import com.maxcar.tablet.ui.home.DeviceHomeViewModel
import com.maxcar.tablet.ui.player.PlayerScreen
import com.maxcar.tablet.ui.player.PlayerUiState
import com.maxcar.tablet.ui.player.PlayerViewModel
import com.maxcar.tablet.ui.theme.MaxcarTheme
import com.maxcar.tablet.work.DeviceTelemetry
import com.maxcar.tablet.work.DeviceWorkScheduler
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {

    private var playerModeActive = false

    private val repository: DeviceRepository
        get() = (application as MaxcarApplication).container.deviceRepository

    private val mediaDownloadManager: MediaDownloadManager
        get() = (application as MaxcarApplication).container.mediaDownloadManager

    private val maintenanceAccessController: MaintenanceAccessController
        get() = (application as MaxcarApplication).container.maintenanceAccessController

    private val enrollmentViewModel: EnrollmentViewModel by viewModels {
        EnrollmentViewModel.Factory(repository, applicationContext) {
            // The isEnrolled flow (observed in MaxcarApp below) drives the
            // screen switch; nothing else to do here on success.
        }
    }

    private val homeViewModel: DeviceHomeViewModel by viewModels {
        DeviceHomeViewModel.Factory(
            repository,
            mediaDownloadManager,
            applicationContext,
            { DeviceTelemetry.collect(applicationContext) },
            (application as MaxcarApplication).container.geoEngine,
        )
    }

    private val playerViewModel: PlayerViewModel by viewModels {
        PlayerViewModel.Factory(
            repository,
            mediaDownloadManager,
            (application as MaxcarApplication).container.appPreferences,
            applicationContext,
            (application as MaxcarApplication).container.geoEngine,
            (application as MaxcarApplication).container.commandExecutor.restartPlayerSignal,
            (application as MaxcarApplication).container.database.mediaQuarantineDao(),
        )
    }

    /** Requested once at startup, not gated behind any user flow (item 4):
     * the pilot has no use for the app without location, so there's no
     * "decide later" screen to build — a denial simply means GEO stays
     * inactive and the panel reports permission as not granted, while
     * REGULAR playback keeps working normally. */
    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        // The player/service may already have attempted to start while the
        // permission dialog was open. Re-evaluate now so the first trip does
        // not require killing or reopening the application before GEO works.
        if (playerModeActive) {
            (application as MaxcarApplication).container.geoEngine.refreshLocationPermission()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        requestLocationPermissionIfNeeded()
        configureDeviceOwnerLockTaskPoliciesIfApplicable()
        setContent {
            MaxcarTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MaxcarApp(
                        repository = repository,
                        enrollmentViewModel = enrollmentViewModel,
                        homeViewModel = homeViewModel,
                        playerViewModel = playerViewModel,
                        maintenanceAccessController = maintenanceAccessController,
                        appPreferences = (application as MaxcarApplication).container.appPreferences,
                        onModeChanged = ::applyKioskMode,
                    )
                }
            }
        }
    }

    private fun requestLocationPermissionIfNeeded() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            locationPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            )
        }
    }

    /** Fullscreen immersive + keep-screen-on whenever the player is the
     * active screen (items 24/25), regardless of whether it has content
     * yet — the diagnostic screen keeps the normal system UI and lets the
     * tablet sleep like any other tool.
     *
     * Rigid screen pinning (`startLockTask`) is a separate, stricter gate:
     * [lockTaskEligible] is only true once the player actually has READY
     * content to show *and* the server's `kiosk_enabled` flag allows it
     * (MAX-010's core rule — never trap the operator behind a pinned,
     * content-less screen; the "preparing content" screen stays
     * immersive but unpinned, sync/diagnostics/exit all stay reachable).
     * Lock Task itself is always attempted defensively via `startLockTask`/
     * `stopLockTask` below: on a tablet provisioned as Device Owner (see
     * [configureDeviceOwnerLockTaskPoliciesIfApplicable]) this now achieves
     * real, inescapable pinning; on one that isn't, Android either ignores
     * it or shows OEM screen-pinning UX, never a crash — see
     * `KioskLevelDetector` for how the panel learns what actually engaged.
     *
     * [LocationForegroundService] (MAX-008) follows the immersive
     * lifetime, not the Lock Task one: GPS should keep running while
     * "preparing content" too, since the vehicle may already be moving. */
    private fun applyKioskMode(playerActive: Boolean, lockTaskEligible: Boolean) {
        playerModeActive = playerActive
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (playerActive) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            startLocationForegroundService()
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            stopService(Intent(this, LocationForegroundService::class.java))
        }
        if (lockTaskEligible) {
            runCatching { startLockTask() }
                .onFailure { Log.w("MaxcarMainActivity", "startLockTask unavailable: ${it::class.simpleName}") }
        } else {
            runCatching { stopLockTask() }
        }
    }

    /** MAX-011: `startLockTask()`/`stopLockTask()` alone only ever achieves
     * screen pinning (a user can still long-press Back+Recents to exit,
     * and notifications remain reachable) — real, inescapable kiosk mode
     * additionally requires Device Owner status to declare *this app* as
     * the only Lock Task-allowed package and to strip every optional Lock
     * Task feature (Home, Recents/Overview, notifications, global actions,
     * keyguard). Both calls are idempotent and cheap, so it's safe to make
     * them unconditionally on every cold start rather than tracking
     * "already configured" state that could drift from what
     * DevicePolicyManager actually has recorded. A no-op, not a crash, on
     * a tablet that hasn't been provisioned as Device Owner yet — see
     * ANDROID_PILOT_TABLET_SETUP.md. */
    private fun configureDeviceOwnerLockTaskPoliciesIfApplicable() {
        val devicePolicyManager = getSystemService(DevicePolicyManager::class.java) ?: return
        val admin = AdminReceiver.componentName(this)
        val isDeviceOwner = runCatching { devicePolicyManager.isDeviceOwnerApp(packageName) }
            .getOrDefault(false)
        if (!isDeviceOwner) return
        runCatching {
            devicePolicyManager.setLockTaskPackages(admin, arrayOf(packageName))
            devicePolicyManager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
        }.onFailure { Log.w("MaxcarMainActivity", "Device Owner policy setup failed: ${it::class.simpleName}") }
    }

    private fun startLocationForegroundService() {
        val intent = Intent(this, LocationForegroundService::class.java)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
        }.onFailure { Log.w("MaxcarMainActivity", "LocationForegroundService unavailable: ${it::class.simpleName}") }
    }
}

@Composable
private fun MaxcarApp(
    repository: DeviceRepository,
    enrollmentViewModel: EnrollmentViewModel,
    homeViewModel: DeviceHomeViewModel,
    playerViewModel: PlayerViewModel,
    maintenanceAccessController: MaintenanceAccessController,
    appPreferences: com.maxcar.tablet.data.local.AppPreferences,
    onModeChanged: (playerActive: Boolean, lockTaskEligible: Boolean) -> Unit,
) {
    val isEnrolled by repository.isEnrolled.collectAsState(initial = null)
    val remoteConfig by repository.remoteConfig.collectAsState(initial = null)
    val playerUiState by playerViewModel.uiState.collectAsState()
    var showDiagnostics by remember { mutableStateOf(false) }
    val context = LocalContext.current

    // MAX-011: one deadline (persisted, so it survives a process restart)
    // covers both temporary-exit paths — a physical PIN unlock into
    // diagnostics and a remote disable_kiosk_temporarily command. While
    // `now < kioskSuspendedUntil`, Lock Task stays disengaged regardless of
    // whether the diagnostics screen itself is open.
    val kioskSuspendedUntil by appPreferences.kioskSuspendedUntilMillis.collectAsState(initial = null)
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    val kioskSuspended = kioskSuspendedUntil != null && nowMillis < kioskSuspendedUntil!!
    val maintenanceSecondsRemaining = kioskSuspendedUntil
        ?.let { ((it - nowMillis) / 1000).coerceAtLeast(0) }
        ?.takeIf { kioskSuspended }

    val playerActive = isEnrolled == true && !showDiagnostics
    // MAX-010's core kiosk rule: rigid screen pinning only ever engages
    // once there's actually READY content to show, and only when the
    // server's kiosk_enabled flag allows it — never a pinned,
    // content-less "preparing…" screen the operator can't get out of.
    // MAX-011 adds a third gate: a temporary exit (physical or remote)
    // always wins over an otherwise-eligible player.
    val hasReadyContent = playerUiState is PlayerUiState.Playing
    val lockTaskEligible = playerActive && hasReadyContent &&
        (remoteConfig?.kioskEnabled ?: false) && !kioskSuspended
    LaunchedEffect(playerActive, lockTaskEligible) { onModeChanged(playerActive, lockTaskEligible) }

    // Entering diagnostics (a physical PIN unlock) starts the same
    // maintenance window a remote disable_kiosk_temporarily command would;
    // leaving it (manually or via the timer below) always clears the
    // deadline. Reusing an existing future deadline instead of overwriting
    // it is what makes "reopen the app/screen while suspended" respect the
    // time already elapsed (MAX-011).
    LaunchedEffect(showDiagnostics) {
        if (showDiagnostics) {
            val now = System.currentTimeMillis()
            val existing = appPreferences.kioskSuspendedUntilSnapshot()
            if (existing == null || existing <= now) {
                val timeoutSeconds = remoteConfig?.maintenanceTimeoutSeconds
                    ?: com.maxcar.tablet.data.local.RemoteConfigEntity.DEFAULT_MAINTENANCE_TIMEOUT_SECONDS
                appPreferences.setKioskSuspendedUntil(now + timeoutSeconds * 1000L)
            }
        } else {
            appPreferences.setKioskSuspendedUntil(null)
        }
    }

    // Ticks once a second only while a deadline is actually pending, and
    // auto-returns to the player the moment it passes — the "retornar
    // automaticamente" half of MAX-011, independent of any manual action.
    LaunchedEffect(kioskSuspendedUntil) {
        while (kioskSuspendedUntil != null) {
            nowMillis = System.currentTimeMillis()
            if (nowMillis >= kioskSuspendedUntil!!) {
                appPreferences.setKioskSuspendedUntil(null)
                if (showDiagnostics) showDiagnostics = false
                break
            }
            delay(1000)
        }
    }

    // "Atualização ao abrir o app" (item 43): scheduleInitialSync only
    // otherwise runs once, right after a *new* enrollment succeeds. A cold
    // start on an already-enrolled device — including one updated from a
    // build that didn't schedule media sync yet — needs its own trigger,
    // or it would never pick up a periodic job it's missing. Re-running it
    // is safe: refreshConfig + (re)scheduling both workers with
    // ExistingWorkPolicy.REPLACE / UPDATE is idempotent.
    LaunchedEffect(isEnrolled) {
        if (isEnrolled == true) DeviceWorkScheduler.scheduleInitialSync(context)
    }

    // The player screen blocks the back gesture/button on purpose (item
    // 26): the only documented way out is the hidden tap gesture + PIN
    // into diagnostics, or an ADB command during the pilot.
    BackHandler(enabled = playerActive) {}

    // Logs maintenance entry/exit (MAX-010) purely from the screen
    // transition — MaintenanceAccessController.attemptUnlock already logs
    // entry on a correct PIN; this covers the exit half without needing
    // the "back to player" button to know about the controller itself.
    // Read by SyncCoordinator to report operational_status = "maintenance"
    // on the heartbeat while this screen is open (MAX-010).
    LaunchedEffect(showDiagnostics) {
        (context.applicationContext as MaxcarApplication).container.appPreferences
            .setDiagnosticsOpen(showDiagnostics)
    }

    DisposableEffect(showDiagnostics) {
        // Captured as a plain val, not read again inside onDispose: by the
        // time onDispose runs, showDiagnostics (a delegated State read)
        // would already reflect the *new* value, not the one this effect
        // was registered for.
        val wasInDiagnostics = showDiagnostics
        onDispose { if (wasInDiagnostics) maintenanceAccessController.logExit() }
    }

    when (isEnrolled) {
        null -> Unit // Still reading DataStore; avoid an enrollment/player flash.
        true -> if (showDiagnostics) {
            DeviceHomeScreen(
                homeViewModel,
                onBackToPlayer = { showDiagnostics = false },
                secondsUntilAutoReturn = maintenanceSecondsRemaining,
            )
        } else {
            PlayerScreen(
                playerViewModel,
                maintenanceAccessController,
                onOpenDiagnostics = { showDiagnostics = true },
            )
        }
        false -> EnrollmentScreen(enrollmentViewModel)
    }
}
