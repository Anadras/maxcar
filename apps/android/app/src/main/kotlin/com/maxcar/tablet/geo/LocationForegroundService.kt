package com.maxcar.tablet.geo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.maxcar.tablet.MaxcarApplication
import com.maxcar.tablet.R
import com.maxcar.tablet.sync.ForegroundSyncLoop
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Keeps both the GEO Location Engine and the short foreground sync cadence
 * running while the tablet is in operational (kiosk) mode. Android's
 * background execution and location limits mean continuous location
 * updates need a foreground service of their own — this one exists to hold
 * that guarantee, and doubles as the host for
 * [ForegroundSyncLoop] (MAX-011 item 6) since the two share the exact same
 * lifetime: both should only run while the tablet is actually operating,
 * never behind the diagnostics screen or before the player has anything
 * to show. All the actual location/geofence logic lives in [GeoEngine];
 * all the actual sync logic lives in
 * [com.maxcar.tablet.sync.SyncCoordinator] — this class only owns their
 * start/stop timing. Started and stopped by MainActivity alongside kiosk
 * mode itself (MAX-008 item 12: prefer a foreground service over relying
 * on passive/background geofencing), never launched on its own, e.g. at
 * boot.
 */
class LocationForegroundService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var foregroundSyncLoop: ForegroundSyncLoop? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        val container = (application as MaxcarApplication).container
        container.geoEngine.start()
        if (foregroundSyncLoop == null) {
            foregroundSyncLoop = ForegroundSyncLoop(applicationContext, container.syncCoordinator, serviceScope)
        }
        foregroundSyncLoop?.start()
        return START_STICKY
    }

    override fun onDestroy() {
        foregroundSyncLoop?.stop()
        serviceScope.cancel()
        (application as MaxcarApplication).container.geoEngine.stop()
        super.onDestroy()
    }

    private fun buildNotification() = run {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MAXCAR — operação",
                NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Player e localização em operação")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }

    private companion object {
        const val CHANNEL_ID = "maxcar_operational"
        const val NOTIFICATION_ID = 1001
    }
}
