package com.maxcar.tablet.di

import android.content.Context
import androidx.datastore.preferences.preferencesDataStore
import com.maxcar.tablet.BuildConfig
import com.maxcar.tablet.data.local.AppDatabase
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.local.SecureTokenStore
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.GeoRepository
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.geo.LocationEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

private val Context.dataStore by preferencesDataStore(name = "maxcar_prefs")

/**
 * Manual, no-framework dependency wiring. The app is small enough that a
 * DI framework (Hilt) would add build-time cost without solving a real
 * problem yet; revisit if the object graph grows past what's readable here.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val installationIdStore = InstallationIdStore(appContext.dataStore)
    val appPreferences = AppPreferences(appContext.dataStore)
    val secureTokenStore = SecureTokenStore(appContext)
    val database: AppDatabase = AppDatabase.getInstance(appContext)
    val apiClient = DeviceApiClient(baseUrl = BuildConfig.DEVICE_API_BASE_URL)

    val deviceRepository = DeviceRepository(
        apiClient = apiClient,
        installationIdStore = installationIdStore,
        secureTokenStore = secureTokenStore,
        appPreferences = appPreferences,
        deviceStateDao = database.deviceStateDao(),
        remoteConfigDao = database.remoteConfigDao(),
        pendingEventDao = database.pendingEventDao(),
        playbackEventDao = database.playbackEventDao(),
    )

    val mediaDownloadManager = MediaDownloadManager(
        context = appContext,
        apiClient = apiClient,
        tokenStore = secureTokenStore,
        playlistItemDao = database.playlistItemDao(),
        appPreferences = appPreferences,
    )

    // Outlives any single Activity/ViewModel: location updates and the
    // geofence state machine must keep running across screen changes while
    // the app process is alive, the same lifetime as the foreground
    // service that hosts them (see LocationForegroundService).
    private val geoScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val geoRulesSyncManager = GeoRulesSyncManager(
        context = appContext,
        apiClient = apiClient,
        tokenStore = secureTokenStore,
        geoRuleDao = database.geoRuleDao(),
    )

    val geoRepository = GeoRepository(
        apiClient = apiClient,
        tokenStore = secureTokenStore,
        geofenceEventDao = database.geofenceEventDao(),
    )

    val geoEngine = GeoEngine(
        locationEngine = LocationEngine(appContext),
        geoRulesSyncManager = geoRulesSyncManager,
        geoRuleDao = database.geoRuleDao(),
        geofenceEventDao = database.geofenceEventDao(),
        scope = geoScope,
    )
}
