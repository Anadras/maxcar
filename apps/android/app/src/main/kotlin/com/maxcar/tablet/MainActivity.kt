package com.maxcar.tablet

import android.Manifest
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
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.LocationForegroundService
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

class MainActivity : ComponentActivity() {

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
        )
    }

    /** Requested once at startup, not gated behind any user flow (item 4):
     * the pilot has no use for the app without location, so there's no
     * "decide later" screen to build — a denial simply means GEO stays
     * inactive and the panel reports permission as not granted, while
     * REGULAR playback keeps working normally. */
    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* GeoEngine re-checks the permission itself the next time it starts. */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        requestLocationPermissionIfNeeded()
        setContent {
            MaxcarTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MaxcarApp(
                        repository = repository,
                        enrollmentViewModel = enrollmentViewModel,
                        homeViewModel = homeViewModel,
                        playerViewModel = playerViewModel,
                        maintenanceAccessController = maintenanceAccessController,
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
     * Lock Task itself is still attempted defensively: without Device
     * Owner provisioning (not done for this pilot — see
     * ANDROID_PILOT_TABLET_SETUP.md) Android either ignores it or shows
     * OEM screen-pinning UX, never a crash — see `KioskLevelDetector` for
     * how the panel learns what actually engaged.
     *
     * [LocationForegroundService] (MAX-008) follows the immersive
     * lifetime, not the Lock Task one: GPS should keep running while
     * "preparing content" too, since the vehicle may already be moving. */
    private fun applyKioskMode(playerActive: Boolean, lockTaskEligible: Boolean) {
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
    onModeChanged: (playerActive: Boolean, lockTaskEligible: Boolean) -> Unit,
) {
    val isEnrolled by repository.isEnrolled.collectAsState(initial = null)
    val remoteConfig by repository.remoteConfig.collectAsState(initial = null)
    val playerUiState by playerViewModel.uiState.collectAsState()
    var showDiagnostics by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val playerActive = isEnrolled == true && !showDiagnostics
    // MAX-010's core kiosk rule: rigid screen pinning only ever engages
    // once there's actually READY content to show, and only when the
    // server's kiosk_enabled flag allows it — never a pinned,
    // content-less "preparing…" screen the operator can't get out of.
    val hasReadyContent = playerUiState is PlayerUiState.Playing
    val lockTaskEligible = playerActive && hasReadyContent &&
        (remoteConfig?.kioskEnabled ?: false)
    LaunchedEffect(playerActive, lockTaskEligible) { onModeChanged(playerActive, lockTaskEligible) }

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
            DeviceHomeScreen(homeViewModel, onBackToPlayer = { showDiagnostics = false })
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
