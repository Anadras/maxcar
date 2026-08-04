package com.maxcar.tablet.kiosk

import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.RemoteConfigDao

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
) {
    suspend fun attemptUnlock(pin: String): UnlockResult {
        val now = System.currentTimeMillis()
        val lockedUntil = appPreferences.pinLockedUntilSnapshot()
        if (lockedUntil != null && now < lockedUntil) {
            return UnlockResult.LockedOut(lockedUntil)
        }

        val config = remoteConfigDao.get()
        val hash = config?.maintenancePinHash
        val salt = config?.maintenancePinSalt
        if (hash == null || salt == null) return UnlockResult.NoPinConfigured

        if (PinValidator.matches(pin, hash, salt)) {
            appPreferences.resetPinAttempts()
            // Never logs the PIN itself — only that entry happened, same
            // rule DeviceRepository.logFailure already follows for every
            // other sensitive value in this app.
            android.util.Log.i(LOG_TAG, "maintenance_entered")
            return UnlockResult.Success
        }

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
        const val LOCKOUT_DURATION_MILLIS = 5 * 60 * 1000L
        private const val LOG_TAG = "MaxcarMaintenance"
    }
}
