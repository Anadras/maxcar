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
    )
}
