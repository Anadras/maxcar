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
import com.maxcar.tablet.ui.enrollment.EnrollmentScreen
import com.maxcar.tablet.ui.enrollment.EnrollmentViewModel
import com.maxcar.tablet.ui.home.DeviceHomeScreen
import com.maxcar.tablet.ui.home.DeviceHomeViewModel
import com.maxcar.tablet.ui.player.PlayerScreen
import com.maxcar.tablet.ui.player.PlayerViewModel
import com.maxcar.tablet.ui.theme.MaxcarTheme
import com.maxcar.tablet.work.DeviceTelemetry
import com.maxcar.tablet.work.DeviceWorkScheduler

class MainActivity : ComponentActivity() {

    private val repository: DeviceRepository
        get() = (application as MaxcarApplication).container.deviceRepository

    private val mediaDownloadManager: MediaDownloadManager
        get() = (application as MaxcarApplication).container.mediaDownloadManager

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

    /** Fullscreen immersive + keep-screen-on only while the player is the
     * active screen (items 24/25) — the diagnostic screen keeps the normal
     * system UI and lets the tablet sleep like any other tool. Lock Task
     * is attempted defensively: without Device Owner provisioning (not
     * done for this pilot — see ANDROID_PILOT_TABLET_SETUP.md) Android
     * either ignores it or shows OEM screen-pinning UX, never a crash.
     * [LocationForegroundService] (MAX-008) follows the same lifetime: GPS
     * only runs while the player is actually the operational screen, never
     * in the background behind diagnostics. */
    private fun applyKioskMode(playerActive: Boolean) {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (playerActive) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            runCatching { startLockTask() }
                .onFailure { Log.w("MaxcarMainActivity", "startLockTask unavailable: ${it::class.simpleName}") }
            startLocationForegroundService()
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            runCatching { stopLockTask() }
            stopService(Intent(this, LocationForegroundService::class.java))
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
    onModeChanged: (playerActive: Boolean) -> Unit,
) {
    val isEnrolled by repository.isEnrolled.collectAsState(initial = null)
    var showDiagnostics by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val playerActive = isEnrolled == true && !showDiagnostics
    LaunchedEffect(playerActive) { onModeChanged(playerActive) }

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
    // 26): the only documented way out is the hidden tap gesture into
    // diagnostics, or an ADB command during the pilot.
    BackHandler(enabled = playerActive) {}

    when (isEnrolled) {
        null -> Unit // Still reading DataStore; avoid an enrollment/player flash.
        true -> if (showDiagnostics) {
            DeviceHomeScreen(homeViewModel, onBackToPlayer = { showDiagnostics = false })
        } else {
            PlayerScreen(playerViewModel, onOpenDiagnostics = { showDiagnostics = true })
        }
        false -> EnrollmentScreen(enrollmentViewModel)
    }
}
