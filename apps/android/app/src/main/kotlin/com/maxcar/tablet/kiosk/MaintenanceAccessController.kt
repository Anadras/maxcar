package com.maxcar.tablet.kiosk

import android.os.SystemClock
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.repository.MaintenanceTempCodeVerifier

/** What happened when an operator tried to enter maintenance mode
 * (MAX-010) — never just true/false, since a wrong PIN, a lockout and "no
 * PIN configured yet" each need a different message on screen. */
sealed class UnlockResult {
    data object Success : UnlockResult()
    data class WrongPin(val remainingAttempts: Int) : UnlockResult()
    data class LockedOut(val untilMillis: Long) : UnlockResult()
    data object NoPinConfigured : UnlockResult()
}

/**
 * Gate between the hidden diagnostic-tap gesture and the diagnostics
 * screen: a gesture alone is never enough (MAX-010 — must always go
 * through a PIN dialog first). Owns the local attempt-lockout state, since
 * that's the actual defense against PIN brute force (a short numeric PIN's
 * hash offers little on its own — see [PinValidator]).
 */
class MaintenanceAccessController(
    private val remoteConfigDao: RemoteConfigDao,
    private val appPreferences: AppPreferences,
    private val tempCodeVerifier: MaintenanceTempCodeVerifier,
) {
    suspend fun attemptUnlock(pin: String): UnlockResult {
        // MAX-013: SystemClock.elapsedRealtime() (monotonic, ticks even
        // through deep sleep) instead of the wall clock — someone with
        // physical access can trivially wind the wall clock back to
        // bypass a lockout; the boot-relative monotonic clock can't be
        // adjusted that way. Deliberately doesn't survive a genuine
        // reboot (that resets the counter too), the one tradeoff of a
        // monotonic-since-boot clock — a reboot already costs more time
        // and leaves its own trail than waiting out a 15-minute lockout.
        val now = SystemClock.elapsedRealtime()
        val lockedUntil = appPreferences.pinLockedUntilSnapshot()
        if (lockedUntil != null && now < lockedUntil) {
            return UnlockResult.LockedOut(lockedUntil)
        }

        val config = remoteConfigDao.get()
        val hash = config?.maintenancePinHash

        if (hash != null &&
            PinValidator.matches(pin, hash, config.maintenancePinSalt, config.maintenancePinHashVersion)
        ) {
            appPreferences.resetPinAttempts()
            // Never logs the PIN itself — only that entry happened, same
            // rule DeviceRepository.logFailure already follows for every
            // other sensitive value in this app.
            android.util.Log.i(LOG_TAG, "maintenance_entered")
            return UnlockResult.Success
        }

        // MAX-013: the same 6-digit field also accepts a remote temporary
        // code (online-only, single-use, 5-minute TTL) — tried whenever
        // the permanent PIN didn't match, including when no permanent PIN
        // is configured yet at all. A network/credential problem here is
        // never distinguishable from "no such code" — see
        // DeviceRepository.verifyMaintenanceTempCode.
        if (tempCodeVerifier.verifyMaintenanceTempCode(pin)) {
            appPreferences.resetPinAttempts()
            android.util.Log.i(LOG_TAG, "maintenance_entered_temp_code")
            return UnlockResult.Success
        }

        if (hash == null) return UnlockResult.NoPinConfigured

        val attempts = appPreferences.incrementPinAttemptCount()
        return if (attempts >= MAX_ATTEMPTS) {
            val until = now + LOCKOUT_DURATION_MILLIS
            appPreferences.setPinLockedUntil(until)
            UnlockResult.LockedOut(until)
        } else {
            UnlockResult.WrongPin(remainingAttempts = MAX_ATTEMPTS - attempts)
        }
    }

    fun logExit() {
        android.util.Log.i(LOG_TAG, "maintenance_exited")
    }

    companion object {
        const val MAX_ATTEMPTS = 5
        const val LOCKOUT_DURATION_MILLIS = 15 * 60 * 1000L
        private const val LOG_TAG = "MaxcarMaintenance"
    }
}
