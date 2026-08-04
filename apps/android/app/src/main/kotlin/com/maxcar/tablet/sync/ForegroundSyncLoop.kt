package com.maxcar.tablet.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The short, foreground-only sync cadence WorkManager's 15-minute periodic
 * floor can't provide (MAX-011 item 6). Owned by
 * [com.maxcar.tablet.geo.LocationForegroundService] — same lifetime as the
 * player's operational mode, so a change made in the panel reaches a tablet
 * that's actually on and playing within `TICK_INTERVAL_MS`, without waiting
 * on the periodic [com.maxcar.tablet.work.SyncWorker] (which remains the
 * background/closed-app redundancy layer, unchanged).
 *
 * Two independent triggers, both calling the exact same
 * [SyncCoordinator.runCycle] the periodic worker uses — no separate "fast
 * path" logic to keep in sync with the real one:
 * - a plain ticking loop, so a change is picked up even if connectivity
 *   never flips (it was already online the whole time);
 * - a [ConnectivityManager.NetworkCallback], so "internet just came back"
 *   doesn't wait for the next tick.
 */
class ForegroundSyncLoop(
    private val context: Context,
    private val syncCoordinator: SyncCoordinator,
    private val scope: CoroutineScope,
) {
    private var tickerJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (tickerJob?.isActive == true) return
        tickerJob = scope.launch {
            while (isActive) {
                runCatching { syncCoordinator.runCycle() }
                delay(TICK_INTERVAL_MS)
            }
        }
        registerNetworkCallback()
    }

    fun stop() {
        tickerJob?.cancel()
        tickerJob = null
        unregisterNetworkCallback()
    }

    private fun registerNetworkCallback() {
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Runs on a binder thread, not this class's own scope's
                // thread — launch back into it rather than doing any work
                // directly here.
                scope.launch { runCatching { syncCoordinator.runCycle() } }
            }
        }
        networkCallback = callback
        runCatching { connectivityManager.registerDefaultNetworkCallback(callback) }
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        runCatching { connectivityManager?.unregisterNetworkCallback(callback) }
        networkCallback = null
    }

    private companion object {
        // The pilot's SLA (docs/architecture/ANDROID_SYNC.md): an admin
        // change reaches an online, foreground tablet within 30 seconds.
        const val TICK_INTERVAL_MS = 30_000L
    }
}
