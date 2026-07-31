package com.maxcar.tablet.work

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Environment
import android.os.StatFs

/**
 * Everything a heartbeat reports, collected without asking for any
 * permission beyond the network-state one already declared in the
 * manifest. No location: MAX-006 does not request GPS access.
 */
data class DeviceTelemetry(
    val batteryLevel: Int?,
    val networkType: String,
    val storageFreeBytes: Long?,
) {
    companion object {
        fun collect(context: Context): DeviceTelemetry {
            val batteryManager =
                context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            val batteryLevel = batteryManager
                ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                ?.takeIf { it in 0..100 }

            val networkType = runCatching {
                val connectivityManager = context.getSystemService(
                    Context.CONNECTIVITY_SERVICE,
                ) as ConnectivityManager
                val network = connectivityManager.activeNetwork
                val capabilities = network?.let { connectivityManager.getNetworkCapabilities(it) }
                when {
                    capabilities == null -> "offline"
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "wifi"
                    else -> "offline"
                }
            }.getOrDefault("offline")

            val storageFreeBytes = runCatching {
                StatFs(Environment.getDataDirectory().path).availableBytes
            }.getOrNull()

            return DeviceTelemetry(batteryLevel, networkType, storageFreeBytes)
        }
    }
}
