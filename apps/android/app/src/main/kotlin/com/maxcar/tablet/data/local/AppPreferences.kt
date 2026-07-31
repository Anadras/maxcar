package com.maxcar.tablet.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Simple, non-sensitive app-level flags. Everything richer (device/vehicle
 * identity, remote config, the offline event queue) lives in Room instead;
 * this store only answers "has this tablet ever finished enrollment?" so
 * the UI can decide which screen to show before Room has even loaded.
 */
class AppPreferences(private val dataStore: DataStore<Preferences>) {

    val isEnrolled: Flow<Boolean> =
        dataStore.data.map { prefs -> prefs[KEY_IS_ENROLLED] ?: false }

    suspend fun setEnrolled(enrolled: Boolean) {
        dataStore.edit { prefs -> prefs[KEY_IS_ENROLLED] = enrolled }
    }

    private companion object {
        val KEY_IS_ENROLLED = booleanPreferencesKey("is_enrolled")
    }
}
