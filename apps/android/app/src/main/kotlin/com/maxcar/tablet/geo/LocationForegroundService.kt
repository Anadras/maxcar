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

/**
 * Keeps the GEO Location Engine running while the tablet is in operational
 * (kiosk) mode. Android's background execution and location limits mean
 * continuous location updates need a foreground service of their own —
 * this one exists purely to hold that guarantee; all the actual location
 * and geofence logic lives in [GeoEngine]. Started and stopped by
 * MainActivity alongside kiosk mode itself (MAX-008 item 12: prefer a
 * foreground service over relying on passive/background geofencing), never
 * launched on its own, e.g. at boot.
 */
class LocationForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        (application as MaxcarApplication).container.geoEngine.start()
        return START_STICKY
    }

    override fun onDestroy() {
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
