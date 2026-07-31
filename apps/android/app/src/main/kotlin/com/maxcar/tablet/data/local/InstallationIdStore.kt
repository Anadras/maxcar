package com.maxcar.tablet.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import java.util.UUID

/**
 * The tablet's own identity, independent of any backend enrollment.
 *
 * This is deliberately NOT a hardware identifier (ANDROID_ID, serial, IMEI):
 * those are metadata we may report for support purposes, never proof of
 * identity. installation_id is a UUID we generate ourselves on first run,
 * persisted in DataStore so it survives process death, app updates and
 * reboots. It is only ever reset by a factory reset or clearing app data.
 */
class InstallationIdStore(private val dataStore: DataStore<Preferences>) {

    private val key = stringPreferencesKey("installation_id")

    suspend fun getOrCreate(): UUID {
        val existing = dataStore.data.first()[key]
        if (existing != null) {
            return UUID.fromString(existing)
        }
        val created = UUID.randomUUID()
        dataStore.edit { prefs -> prefs[key] = created.toString() }
        return created
    }
}
