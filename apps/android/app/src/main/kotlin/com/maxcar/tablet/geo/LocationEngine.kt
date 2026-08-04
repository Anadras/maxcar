package com.maxcar.tablet.geo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * One real location fix, already filtered to a usable accuracy. Never kept
 * beyond the current in-memory evaluation — no route history (MAX-008 item
 * 27: minimal location retention, no passenger association).
 */
data class LocationSample(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val speedMetersPerSecond: Float,
    val bearingDegrees: Float,
    val timestampMillis: Long,
)

/**
 * Thin wrapper around the Fused Location Provider: only ACCESS_FINE/COARSE
 * location, no background-location permission (MAX-008 item 4 — the player
 * runs as a continuous foreground experience, backed by
 * [LocationForegroundService], so foreground-only location is enough for
 * the pilot). Imprecise fixes are dropped here, once, rather than trusted
 * downstream: everything past this point in the GEO engine assumes an
 * accuracy already good enough to evaluate against a geofence radius.
 */
class LocationEngine(private val context: Context) {
    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start(onLocation: (LocationSample) -> Unit, onError: (String) -> Unit) {
        if (!hasPermission()) {
            onError("permission_denied")
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                // Ignores imprecise fixes (item 5): a fix with a very wide
                // accuracy radius is worse than no fix for a geofence whose
                // own radius may be similarly small.
                if (location.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return
                onLocation(
                    LocationSample(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracyMeters = location.accuracy,
                        speedMetersPerSecond = location.speed,
                        bearingDegrees = location.bearing,
                        timestampMillis = location.time,
                    ),
                )
            }
        }
        callback = cb
        runCatching {
            fusedClient.requestLocationUpdates(request, cb, Looper.getMainLooper())
        }.onFailure { onError(it::class.simpleName ?: "location_start_failed") }
    }

    fun stop() {
        callback?.let { fusedClient.removeLocationUpdates(it) }
        callback = null
    }

    companion object {
        // A pilot-appropriate cadence: frequent enough to catch entering a
        // ~100-300m radius at street speed, not so frequent it drains the
        // battery of a tablet that's plugged in but still shares power
        // with the player screen and downloads.
        const val UPDATE_INTERVAL_MS = 15_000L
        const val MIN_UPDATE_INTERVAL_MS = 10_000L
        const val MAX_ACCEPTABLE_ACCURACY_METERS = 50f
    }
}
