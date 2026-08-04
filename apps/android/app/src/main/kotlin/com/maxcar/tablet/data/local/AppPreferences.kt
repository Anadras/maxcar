package com.maxcar.tablet.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Simple, non-sensitive app-level flags. Everything richer (device/vehicle
 * identity, remote config, the offline event queue, the media grade
 * itself) lives in Room instead; this store only answers cheap,
 * synchronous-feeling questions the UI needs before Room has loaded:
 * "has this tablet ever finished enrollment?" and "which manifest version
 * does the locally cached grade already match?".
 */
class AppPreferences(private val dataStore: DataStore<Preferences>) {

    val isEnrolled: Flow<Boolean> =
        dataStore.data.map { prefs -> prefs[KEY_IS_ENROLLED] ?: false }

    suspend fun setEnrolled(enrolled: Boolean) {
        dataStore.edit { prefs -> prefs[KEY_IS_ENROLLED] = enrolled }
    }

    val manifestVersion: Flow<String?> =
        dataStore.data.map { prefs -> prefs[KEY_MANIFEST_VERSION] }

    suspend fun setManifestVersion(version: String) {
        dataStore.edit { prefs -> prefs[KEY_MANIFEST_VERSION] = version }
    }

    suspend fun manifestVersionSnapshot(): String? = manifestVersion.first()

    /** The player's own live status, written by [com.maxcar.tablet.ui.player.PlayerViewModel]
     * on every item transition and read back by [com.maxcar.tablet.work.HeartbeatWorker] —
     * the only way a background worker learns what the foreground player is
     * currently doing, since the two don't otherwise share process state
     * beyond Room/DataStore. */
    suspend fun setPlayerStatus(
        state: String,
        campaignId: String?,
        creativeId: String?,
        lastError: String?,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_PLAYER_STATE] = state
            if (campaignId != null) prefs[KEY_CURRENT_CAMPAIGN_ID] = campaignId else prefs.remove(KEY_CURRENT_CAMPAIGN_ID)
            if (creativeId != null) prefs[KEY_CURRENT_CREATIVE_ID] = creativeId else prefs.remove(KEY_CURRENT_CREATIVE_ID)
            if (lastError != null) prefs[KEY_LAST_ERROR] = lastError else prefs.remove(KEY_LAST_ERROR)
        }
    }

    suspend fun playerStatusSnapshot(): PlayerStatusSnapshot = PlayerStatusSnapshot(
        state = dataStore.data.map { it[KEY_PLAYER_STATE] }.first(),
        campaignId = dataStore.data.map { it[KEY_CURRENT_CAMPAIGN_ID] }.first(),
        creativeId = dataStore.data.map { it[KEY_CURRENT_CREATIVE_ID] }.first(),
        lastError = dataStore.data.map { it[KEY_LAST_ERROR] }.first(),
    )

    data class PlayerStatusSnapshot(
        val state: String?,
        val campaignId: String?,
        val creativeId: String?,
        val lastError: String?,
    )

    private companion object {
        val KEY_IS_ENROLLED = booleanPreferencesKey("is_enrolled")
        val KEY_MANIFEST_VERSION = stringPreferencesKey("manifest_version")
        val KEY_PLAYER_STATE = stringPreferencesKey("player_state")
        val KEY_CURRENT_CAMPAIGN_ID = stringPreferencesKey("current_campaign_id")
        val KEY_CURRENT_CREATIVE_ID = stringPreferencesKey("current_creative_id")
        val KEY_LAST_ERROR = stringPreferencesKey("last_error")
    }
}
