package com.maxcar.tablet.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
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

    /** How far the tablet's own clock diverged from the server's, as of the
     * last successful heartbeat response (MAX-009). Null means "never
     * measured yet" — treated as trustworthy by default so a brand-new
     * device isn't wrongly denied local expiry enforcement before its
     * first sync. Reported back on the *next* heartbeat, since the skew
     * can only be computed after a round trip completes. */
    val clockSkewSeconds: Flow<Int?> =
        dataStore.data.map { prefs -> prefs[KEY_CLOCK_SKEW_SECONDS] }

    suspend fun setClockSkewSeconds(skewSeconds: Int) {
        dataStore.edit { prefs -> prefs[KEY_CLOCK_SKEW_SECONDS] = skewSeconds }
    }

    suspend fun clockSkewSnapshot(): Int? = clockSkewSeconds.first()

    /** MAX-010 admin PIN lockout state — purely local, since the tablet
     * must be able to enforce a lockout offline. Never reset by anything
     * except a correct PIN or the lockout window elapsing. */
    suspend fun pinAttemptCountSnapshot(): Int =
        dataStore.data.map { it[KEY_PIN_ATTEMPT_COUNT] ?: 0 }.first()

    suspend fun incrementPinAttemptCount(): Int {
        var newCount = 0
        dataStore.edit { prefs ->
            newCount = (prefs[KEY_PIN_ATTEMPT_COUNT] ?: 0) + 1
            prefs[KEY_PIN_ATTEMPT_COUNT] = newCount
        }
        return newCount
    }

    suspend fun resetPinAttempts() {
        dataStore.edit { prefs ->
            prefs[KEY_PIN_ATTEMPT_COUNT] = 0
            prefs.remove(KEY_PIN_LOCKED_UNTIL_MILLIS)
        }
    }

    suspend fun pinLockedUntilSnapshot(): Long? =
        dataStore.data.map { it[KEY_PIN_LOCKED_UNTIL_MILLIS] }.first()

    suspend fun setPinLockedUntil(untilMillis: Long) {
        dataStore.edit { prefs -> prefs[KEY_PIN_LOCKED_UNTIL_MILLIS] = untilMillis }
    }

    /** Set by [com.maxcar.tablet.sync.DeviceCommandExecutor] on an
     * enter_maintenance/exit_maintenance remote command (MAX-009); read by
     * the kiosk/maintenance-mode flow (MAX-010) once built. Kept here
     * rather than in a new store so both marcos share one small,
     * synchronous-feeling source of truth for "should the tablet be in
     * maintenance mode right now". */
    val maintenanceRequested: Flow<Boolean> =
        dataStore.data.map { prefs -> prefs[KEY_MAINTENANCE_REQUESTED] ?: false }

    suspend fun setMaintenanceRequested(requested: Boolean) {
        dataStore.edit { prefs -> prefs[KEY_MAINTENANCE_REQUESTED] = requested }
    }

    /** Whether the diagnostics/maintenance screen is currently open —
     * set by `MaxcarApp` on every `showDiagnostics` transition, read by
     * [com.maxcar.tablet.sync.SyncCoordinator] so the heartbeat can report
     * `operational_status = "maintenance"` while a technician is in there,
     * overriding the player-state-derived status. */
    suspend fun setDiagnosticsOpen(open: Boolean) {
        dataStore.edit { prefs -> prefs[KEY_DIAGNOSTICS_OPEN] = open }
    }

    suspend fun diagnosticsOpenSnapshot(): Boolean =
        dataStore.data.map { it[KEY_DIAGNOSTICS_OPEN] ?: false }.first()

    private companion object {
        val KEY_IS_ENROLLED = booleanPreferencesKey("is_enrolled")
        val KEY_MANIFEST_VERSION = stringPreferencesKey("manifest_version")
        val KEY_PLAYER_STATE = stringPreferencesKey("player_state")
        val KEY_CURRENT_CAMPAIGN_ID = stringPreferencesKey("current_campaign_id")
        val KEY_CURRENT_CREATIVE_ID = stringPreferencesKey("current_creative_id")
        val KEY_LAST_ERROR = stringPreferencesKey("last_error")
        val KEY_CLOCK_SKEW_SECONDS = intPreferencesKey("clock_skew_seconds")
        val KEY_MAINTENANCE_REQUESTED = booleanPreferencesKey("maintenance_requested")
        val KEY_DIAGNOSTICS_OPEN = booleanPreferencesKey("diagnostics_open")
        val KEY_PIN_ATTEMPT_COUNT = intPreferencesKey("pin_attempt_count")
        val KEY_PIN_LOCKED_UNTIL_MILLIS = longPreferencesKey("pin_locked_until_millis")
    }
}
