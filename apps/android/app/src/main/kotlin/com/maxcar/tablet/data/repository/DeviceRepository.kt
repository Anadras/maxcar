package com.maxcar.tablet.data.repository

import android.os.Build
import com.maxcar.tablet.BuildConfig
import com.maxcar.tablet.data.local.AppPreferences
import com.maxcar.tablet.data.local.DeviceKeyStore
import com.maxcar.tablet.data.local.DeviceStateDao
import com.maxcar.tablet.data.local.DeviceStateEntity
import com.maxcar.tablet.data.local.InstallationIdStore
import com.maxcar.tablet.data.local.PendingEventDao
import com.maxcar.tablet.data.local.PendingEventEntity
import com.maxcar.tablet.data.local.PlaybackEventDao
import com.maxcar.tablet.data.local.PlaybackEventEntity
import com.maxcar.tablet.data.local.RemoteConfigDao
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.remote.DeviceApiClient
import com.maxcar.tablet.data.remote.EnrollKeyCompleteRequest
import com.maxcar.tablet.data.remote.EnrollKeyStartRequest
import com.maxcar.tablet.data.remote.HeartbeatRequest
import com.maxcar.tablet.data.remote.PlaybackEventRequest
import com.maxcar.tablet.data.remote.RecoverKeyCompleteRequest
import com.maxcar.tablet.data.remote.RecoverKeyStartRequest
import com.maxcar.tablet.domain.DeviceApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit

/** What every other sync class (MediaDownloadManager, GeoRulesSyncManager,
 * GeoRepository, DeviceCommandExecutor) needs from [DeviceRepository]:
 * today's signing key id — resolving a lost-local-metadata recovery
 * automatically if the Keystore key is still intact — and how to react
 * when the server rejects that identity. Kept as a narrow interface so
 * those classes never re-derive MAX-010.6's recovery logic themselves. */
interface DeviceIdentityProvider {
    /** The key_id to sign requests with, or null if there is currently no
     * usable device identity (never enrolled, or recovery just failed). */
    suspend fun currentKeyId(): String?

    /** The server rejected the key_id used for the last signed request
     * (unknown key, revoked key, or a bad signature). */
    suspend fun handleUnauthorizedDeviceKey()
}

/** What [com.maxcar.tablet.kiosk.MaintenanceAccessController] needs from
 * [DeviceRepository] — narrow on purpose, same reasoning as
 * [DeviceIdentityProvider]: a test double for maintenance-access logic
 * shouldn't need to stand up this whole class. */
interface MaintenanceTempCodeVerifier {
    suspend fun verifyMaintenanceTempCode(code: String): Boolean
}

/**
 * The single place that knows how enrollment, the device's cryptographic
 * identity, the heartbeat queue and remote config relate to each other. UI
 * and WorkManager workers both go through this, never through
 * [DeviceApiClient] or the DAOs directly.
 *
 * MAX-010.6: there is no static bearer token anywhere in this class. Every
 * device-facing call is authenticated by signing it with [deviceKeyStore]'s
 * Keystore-resident private key; [DeviceStateEntity.keyId] is the
 * non-secret identifier that pairs a signature with the right public key
 * server-side. If that local pairing is ever lost while the Keystore key
 * itself survives (a Room reset, a lost row, `adb install -r` on a build
 * that changed the schema), [resolveKeyId] recovers it automatically via a
 * signed challenge — no new human-typed activation code needed. See
 * docs/architecture/DEVICE_KEY_AUTH.md.
 */
class DeviceRepository(
    private val apiClient: DeviceApiClient,
    private val deviceKeyStore: DeviceKeyStore,
    private val installationIdStore: InstallationIdStore,
    private val appPreferences: AppPreferences,
    private val deviceStateDao: DeviceStateDao,
    private val remoteConfigDao: RemoteConfigDao,
    private val pendingEventDao: PendingEventDao,
    private val playbackEventDao: PlaybackEventDao,
) : DeviceIdentityProvider, MaintenanceTempCodeVerifier {
    val isEnrolled: Flow<Boolean> = appPreferences.isEnrolled
    val deviceState: Flow<DeviceStateEntity?> = deviceStateDao.observe()
    val remoteConfig: Flow<RemoteConfigEntity?> = remoteConfigDao.observe()

    /** True when enrolled but no usable device identity could be resolved
     * (Keystore key missing, or recovery itself failed) — see
     * [resolveKeyId]. Drives a visible recovery banner, never an automatic
     * re-enrollment. */
    val credentialMissingLocally: Flow<Boolean> = appPreferences.credentialMissingLocally

    /** Serializes [enroll] end to end — see that method's doc for why. */
    private val enrollMutex = Mutex()

    suspend fun installationId(): UUID = installationIdStore.getOrCreate()

    override suspend fun currentKeyId(): String? = resolveKeyId("currentKeyId")

    override suspend fun handleUnauthorizedDeviceKey() {
        // The server rejected this key_id — could be a genuine revocation
        // or a stale/mismatched local pairing. Never delete the Keystore
        // key itself and never touch device/vehicle history: just drop the
        // *local* key_id so the very next cycle's resolveKeyId() retries
        // through the recovery flow. Recovery cleanly fails closed if the
        // key really was revoked (start_device_key_recovery rejects a
        // revoked fingerprint the same as an unknown one), which surfaces
        // as the existing credentialMissingLocally banner — no separate
        // "revoked" state needed on top of that.
        deviceStateDao.get()?.let {
            deviceStateDao.upsert(it.copy(keyId = null, updatedAt = System.currentTimeMillis()))
        }
    }

    /** Exchanges a human-typed enrollment code for an activated device key.
     * Generates the tablet's Keystore key pair first if one doesn't exist
     * yet (idempotent: a retry reuses the same key and the same public
     * key/fingerprint), proves possession of it by signing the server's
     * challenge, then persists the resulting device/vehicle/key identity.
     *
     * Local identity preparation ([DeviceKeyStore.getOrCreateKeyInfo]/
     * [DeviceKeyStore.sign]) always happens *before* the code is ever sent
     * to the server — a Keystore fault must never consume an attempt
     * against, or otherwise be confused with, a rejected code. [enrollMutex]
     * serializes overlapping calls (e.g. a double-tap landing as two
     * coroutines before the UI can disable the button) so two callers can
     * never both race
     * [DeviceKeyStore.getOrCreateKeyInfo]/[apiClient.enrollKeyStart] for the
     * same alias/code at once — [com.maxcar.tablet.data.local.AndroidDeviceKeyStore]
     * has its own internal lock too, but that only protects the Keystore
     * call itself, not this method's own multi-step sequence. */
    suspend fun enroll(code: String): Result<DeviceStateEntity> = enrollMutex.withLock {
        runCatching {
            val installationId = installationIdStore.getOrCreate()
            // Keystore access (especially first-time key generation) is a
            // blocking hardware-crypto call, exactly like the network calls
            // below — never left on the caller's dispatcher (viewModelScope
            // defaults to Main), same reasoning as the withContext calls
            // that already wrap every apiClient call in this method.
            val keyInfo = withContext(Dispatchers.IO) { deviceKeyStore.getOrCreateKeyInfo() }
            val startResponse = withContext(Dispatchers.IO) {
                apiClient.enrollKeyStart(
                    EnrollKeyStartRequest(
                        code = code,
                        installationId = installationId.toString(),
                        publicKey = keyInfo.publicKeyDerBase64,
                        publicKeyFingerprint = keyInfo.fingerprintHex,
                        algorithm = KEY_ALGORITHM,
                        hardwareBacked = keyInfo.hardwareBacked,
                        appVersion = BuildConfig.VERSION_NAME,
                        manufacturer = Build.MANUFACTURER,
                        model = Build.MODEL,
                        androidVersion = Build.VERSION.RELEASE,
                    ),
                )
            }
            val signature = withContext(Dispatchers.IO) {
                deviceKeyStore.sign(Base64.getDecoder().decode(startResponse.challenge))
            }
            val completeResponse = withContext(Dispatchers.IO) {
                apiClient.enrollKeyComplete(
                    EnrollKeyCompleteRequest(
                        enrollmentAttemptId = startResponse.enrollmentAttemptId,
                        signature = Base64.getEncoder().encodeToString(signature),
                    ),
                )
            }
            val state = DeviceStateEntity(
                deviceId = completeResponse.deviceId,
                deviceCode = completeResponse.deviceCode,
                vehicleId = completeResponse.vehicleId,
                vehicleCode = completeResponse.vehicleCode,
                keyId = completeResponse.keyId,
                lastHeartbeatAt = null,
                lastSyncAt = null,
                updatedAt = System.currentTimeMillis(),
            )
            deviceStateDao.upsert(state)
            appPreferences.setEnrolled(true)
            appPreferences.setCredentialMissingLocally(false)
            state
        }.onFailure { error ->
            // A cancelled coroutine (screen navigated away, process
            // backgrounded, ViewModel cleared mid-call) must propagate as a
            // cancellation, per structured concurrency — never be reported
            // to the operator as "falha ao preparar a identidade segura",
            // which is what plain runCatching would otherwise turn it into.
            if (error is CancellationException) throw error
            logFailure("enroll", error)
        }
    }

    /**
     * Sends one heartbeat. On success, clears the corresponding pending
     * event if this was a retry. On [DeviceApiError.Unauthorized] (an
     * unknown, revoked, or otherwise rejected key), the local key_id
     * pairing is dropped so the next cycle retries via recovery — its
     * local data is otherwise left alone, and enrollment is never cleared
     * by a mere network failure or timeout.
     */
    suspend fun sendHeartbeat(
        batteryLevel: Int?,
        networkType: String,
        storageFreeBytes: Long?,
        clientEventId: UUID = UUID.randomUUID(),
        playerState: String? = null,
        mediaReadyCount: Int? = null,
        manifestVersion: String? = null,
        currentCampaignId: String? = null,
        currentCreativeId: String? = null,
        lastError: String? = null,
        latitude: Double? = null,
        longitude: Double? = null,
        gpsAvailable: Boolean = false,
        locationAccuracyMeters: Double? = null,
        locationPermissionGranted: Boolean? = null,
        lastLocationError: String? = null,
        lastGeofenceEntryAt: String? = null,
        lastGeoCampaignId: String? = null,
        operationalStatus: String? = null,
        pendingEventCount: Int? = null,
        kioskLevel: String? = null,
        quarantinedMediaCount: Int? = null,
        kioskReason: String? = null,
    ): Result<Unit> {
        val sentAtMillis = System.currentTimeMillis()
        val clockSkewSeconds = appPreferences.clockSkewSnapshot()
        val keyId = resolveKeyId("sendHeartbeat")
            ?: return Result.failure(DeviceApiError.CredentialUnavailable("No local device identity."))
        val result = runCatching {
            val response = withContext(Dispatchers.IO) {
                apiClient.heartbeat(
                    keyId,
                    HeartbeatRequest(
                        batteryLevel = batteryLevel,
                        networkType = networkType,
                        storageFreeBytes = storageFreeBytes,
                        appVersion = BuildConfig.VERSION_NAME,
                        deviceTime = Instant.now().toString(),
                        clientEventId = clientEventId.toString(),
                        playerState = playerState,
                        mediaReadyCount = mediaReadyCount,
                        manifestVersion = manifestVersion,
                        currentCampaignId = currentCampaignId,
                        currentCreativeId = currentCreativeId,
                        lastError = lastError,
                        latitude = latitude,
                        longitude = longitude,
                        gpsAvailable = gpsAvailable,
                        locationAccuracyMeters = locationAccuracyMeters,
                        locationPermissionGranted = locationPermissionGranted,
                        lastLocationError = lastLocationError,
                        lastGeofenceEntryAt = lastGeofenceEntryAt,
                        lastGeoCampaignId = lastGeoCampaignId,
                        operationalStatus = operationalStatus,
                        pendingEventCount = pendingEventCount,
                        clockSkewSeconds = clockSkewSeconds,
                        kioskLevel = kioskLevel,
                        quarantinedMediaCount = quarantinedMediaCount,
                        kioskReason = kioskReason,
                    ),
                )
            }
            deviceStateDao.get()?.let {
                deviceStateDao.upsert(
                    it.copy(lastHeartbeatAt = response.recordedAt, updatedAt = System.currentTimeMillis()),
                )
            }
            // Clock skew (MAX-009): the server's recordedAt is always its
            // own clock (never the tablet's, per record_device_heartbeat's
            // own contract) — comparing it to the tablet's clock right
            // before/after the round trip gives a usable, if approximate,
            // divergence estimate. Persisted for the *next* cycle's
            // heartbeat and for local-expiry decisions
            // (MediaDownloadManager.readyPlaylist) — never recomputed
            // mid-flight, since a single heartbeat can't measure its own
            // skew before it's answered.
            runCatching {
                val serverMillis = java.time.Instant.parse(response.recordedAt).toEpochMilli()
                val skewSeconds = ((sentAtMillis - serverMillis) / 1000).toInt()
                appPreferences.setClockSkewSeconds(skewSeconds)
            }
            Unit
        }
        result.onFailure { error ->
            logFailure("heartbeat", error)
            when (error) {
                is DeviceApiError.Unauthorized -> handleUnauthorizedDeviceKey()
                is DeviceApiError.NetworkUnavailable ->
                    queuePendingHeartbeat(batteryLevel, networkType, storageFreeBytes, clientEventId)
                else -> Unit
            }
        }
        return result
    }

    /** Attempts to flush queued heartbeats, oldest first. A network outage
     * or a confirmed revocation stops the whole pass (every remaining item
     * would fail identically); any other single event's own failure is
     * recorded and skipped so it can never permanently block everything
     * queued behind it — MAX-011's "evento inválido não bloqueia o lote"
     * requirement, which the previous unconditional `return` on any
     * failure violated. */
    suspend fun flushPendingEvents(limit: Int = 20) {
        val retentionCutoff = System.currentTimeMillis() - RETENTION_MILLIS
        pendingEventDao.pruneOlderThan(retentionCutoff)

        val keyId = resolveKeyId("flushPendingEvents") ?: return
        for (event in pendingEventDao.oldest(limit)) {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    apiClient.heartbeat(
                        keyId,
                        HeartbeatRequest(
                            batteryLevel = event.batteryLevel,
                            networkType = event.networkType,
                            storageFreeBytes = event.storageFreeBytes,
                            appVersion = event.appVersion,
                            deviceTime = Instant.ofEpochMilli(event.deviceTimeMillis).toString(),
                            clientEventId = event.clientEventId,
                        ),
                    )
                }
            }
            result.onSuccess {
                pendingEventDao.delete(event)
            }.onFailure { error ->
                logFailure("flushPendingEvents", error)
                pendingEventDao.recordAttempt(event.id, System.currentTimeMillis())
                when (error) {
                    // A confirmed rejection: every remaining item would
                    // fail the exact same way this cycle.
                    is DeviceApiError.Unauthorized -> {
                        handleUnauthorizedDeviceKey()
                        return
                    }
                    // The server is unreachable at all: retrying the next
                    // item immediately would just fail identically: stop
                    // this pass, try again next cycle.
                    is DeviceApiError.NetworkUnavailable -> return
                    // Any other failure is specific to this one event
                    // (e.g. a malformed payload) — record it and move on,
                    // never let it block everything queued behind it.
                    else -> Unit
                }
            }
        }
    }

    /**
     * Queues one finalized playback attempt locally. Never talks to the
     * network directly — the player calls this the moment a video ends,
     * an image's duration elapses, or playback fails, and
     * [flushPlaybackEvents] uploads whatever's queued later. Returns the
     * event's own id so a caller (tests, diagnostics) can look it up.
     */
    suspend fun recordPlaybackEvent(
        campaignId: String,
        creativeId: String?,
        status: String,
        startedAt: String,
        completedAt: String?,
        durationMs: Long?,
        completionPercentage: Int?,
        failureReason: String?,
        offline: Boolean,
        clientEventId: UUID = UUID.randomUUID(),
    ): UUID {
        playbackEventDao.insert(
            PlaybackEventEntity(
                clientEventId = clientEventId.toString(),
                campaignId = campaignId,
                creativeId = creativeId,
                status = status,
                startedAt = startedAt,
                completedAt = completedAt,
                durationMs = durationMs,
                completionPercentage = completionPercentage,
                failureReason = failureReason,
                offline = offline,
                createdAt = System.currentTimeMillis(),
            ),
        )
        return clientEventId
    }

    /** Uploads queued playback events in one batch call, oldest first.
     * Successful (or already-recorded, from a retried upload) events are
     * removed locally; the rest stay queued for the next call. */
    suspend fun flushPlaybackEvents(limit: Int = 20) {
        val retentionCutoff = System.currentTimeMillis() - RETENTION_MILLIS
        playbackEventDao.pruneOlderThan(retentionCutoff)

        val keyId = resolveKeyId("flushPlaybackEvents") ?: return
        val pending = playbackEventDao.oldest(limit)
        if (pending.isEmpty()) return

        val requests = pending.map { event ->
            PlaybackEventRequest(
                clientEventId = event.clientEventId,
                campaignId = event.campaignId,
                creativeId = event.creativeId,
                status = event.status,
                startedAt = event.startedAt,
                completedAt = event.completedAt,
                durationMs = event.durationMs,
                completionPercentage = event.completionPercentage,
                failureReason = event.failureReason,
                offline = event.offline,
            )
        }

        val result = runCatching {
            withContext(Dispatchers.IO) { apiClient.sendPlaybackEvents(keyId, requests) }
        }
        result.onSuccess { response ->
            // MAX-013: a permanent per-event failure (its campaign/creative
            // no longer exists) is deleted exactly like a success — no
            // retry will ever record it, and holding onto it would block
            // oldest(limit)'s FIFO order from ever reaching newer, still-
            // recordable events behind it.
            response.results.filter { it.ok || it.permanent }.forEach {
                playbackEventDao.delete(it.clientEventId)
            }
            response.results.filter { !it.ok && !it.permanent }.forEach {
                playbackEventDao.recordAttempt(it.clientEventId)
            }
        }.onFailure { error ->
            logFailure("flushPlaybackEvents", error)
            if (error is DeviceApiError.Unauthorized) {
                handleUnauthorizedDeviceKey()
            } else {
                pending.forEach { playbackEventDao.recordAttempt(it.clientEventId) }
            }
        }
    }

    suspend fun refreshConfig(): Result<RemoteConfigEntity> {
        val keyId = resolveKeyId("refreshConfig")
            ?: return Result.failure(DeviceApiError.CredentialUnavailable("No local device identity."))
        return runCatching {
            val response = withContext(Dispatchers.IO) { apiClient.getConfig(keyId) }
            deviceStateDao.get()?.let {
                deviceStateDao.upsert(it.copy(lastSyncAt = Instant.now().toString()))
            }
            val config = RemoteConfigEntity(
                heartbeatIntervalSeconds = response.heartbeatIntervalSeconds,
                syncIntervalSeconds = response.syncIntervalSeconds,
                kioskEnabled = response.kioskEnabled,
                loggingLevel = response.loggingLevel,
                configVersion = response.configVersion,
                updatedAt = System.currentTimeMillis(),
                maintenancePinHash = response.maintenancePinHash,
                maintenancePinSalt = response.maintenancePinSalt,
                maintenancePinHashVersion = response.maintenancePinHashVersion ?: 1,
                maintenanceTimeoutSeconds = response.maintenanceTimeoutSeconds
                    ?: RemoteConfigEntity.DEFAULT_MAINTENANCE_TIMEOUT_SECONDS,
                latestApkVersionCode = response.latestApkVersionCode,
                latestApkVersionName = response.latestApkVersionName,
                latestApkSha256 = response.latestApkSha256,
                latestApkSizeBytes = response.latestApkSizeBytes,
                latestApkDownloadUrl = response.latestApkDownloadUrl,
            )
            remoteConfigDao.upsert(config)
            config
        }.onFailure { error ->
            logFailure("refreshConfig", error)
            if (error is DeviceApiError.Unauthorized) handleUnauthorizedDeviceKey()
        }
    }

    /** Local queue depth across both event kinds — reported on the
     * heartbeat (MAX-009's `pending_event_count`) so the panel can see a
     * backlog forming before it becomes an outage. */
    suspend fun pendingEventCount(): Int = pendingEventDao.count() + playbackEventDao.count()

    suspend fun currentHeartbeatIntervalSeconds(): Long =
        (remoteConfigDao.get() ?: RemoteConfigEntity.defaults())
            .heartbeatIntervalSeconds.toLong()

    /** MAX-013: best-effort online check of a remote temporary maintenance
     * code — never throws, a network/credential problem is indistinguishable
     * from "the code path just isn't available right now" to the caller
     * (see MaintenanceAccessController, which only ever treats a `true`
     * result as meaningful; anything else falls back to the permanent
     * PIN's own local result). */
    override suspend fun verifyMaintenanceTempCode(code: String): Boolean {
        val keyId = resolveKeyId("verifyMaintenanceTempCode") ?: return false
        return runCatching {
            withContext(Dispatchers.IO) { apiClient.verifyMaintenanceCode(keyId, code) }
        }.getOrNull()?.verified ?: false
    }

    /** The one place that decides which key_id to sign a request with.
     * Prefers the locally paired key_id when the Keystore key that
     * produced it is still present (the common, steady-state case). If
     * the Keystore key exists but no local key_id is paired with it — a
     * Room reset, a lost row, a handled-Unauthorized cycle — it recovers
     * the pairing via a signed challenge instead of asking for a new
     * activation code. Returns null (and marks [credentialMissingLocally]
     * if the device is otherwise enrolled) only when there's truly no
     * usable identity: no Keystore key at all, or recovery itself just
     * failed. */
    private suspend fun resolveKeyId(step: String): String? {
        val localKeyId = deviceStateDao.get()?.keyId
        if (localKeyId != null && deviceKeyStore.hasKey()) {
            appPreferences.setCredentialMissingLocally(false)
            return localKeyId
        }
        if (deviceKeyStore.hasKey()) {
            recoverIdentity(step)?.let { return it }
        }
        markCredentialMissingIfEnrolled(step)
        return null
    }

    /** MAX-010.6 recovery: the Keystore key survived (reboot, `adb install
     * -r`, a Room schema wipe) but the local device_id/key_id pairing
     * didn't. Re-derives the public key/fingerprint straight from the
     * Keystore — no locally-stored state needed for that — and proves
     * possession the same way enrollment does, just keyed by fingerprint
     * instead of a human-typed code. */
    private suspend fun recoverIdentity(step: String): String? = runCatching {
        val keyInfo = deviceKeyStore.currentKeyInfo() ?: return null
        val startResponse = withContext(Dispatchers.IO) {
            apiClient.recoverKeyStart(RecoverKeyStartRequest(keyInfo.fingerprintHex))
        }
        val signature = deviceKeyStore.sign(Base64.getDecoder().decode(startResponse.challenge))
        val completeResponse = withContext(Dispatchers.IO) {
            apiClient.recoverKeyComplete(
                RecoverKeyCompleteRequest(
                    recoveryAttemptId = startResponse.recoveryAttemptId,
                    signature = Base64.getEncoder().encodeToString(signature),
                ),
            )
        }
        val existing = deviceStateDao.get()
        deviceStateDao.upsert(
            DeviceStateEntity(
                deviceId = completeResponse.deviceId,
                deviceCode = completeResponse.deviceCode,
                vehicleId = completeResponse.vehicleId,
                vehicleCode = completeResponse.vehicleCode,
                keyId = completeResponse.keyId,
                lastHeartbeatAt = existing?.lastHeartbeatAt,
                lastSyncAt = existing?.lastSyncAt,
                updatedAt = System.currentTimeMillis(),
            ),
        )
        appPreferences.setEnrolled(true)
        appPreferences.setCredentialMissingLocally(false)
        completeResponse.keyId
    }.onFailure { logFailure("$step.recovery", it) }.getOrNull()

    /** A local key read came back empty (no Keystore key, or recovery just
     * failed). If the device isn't marked enrolled, this is expected and
     * harmless — nothing to flag. If it *is* marked enrolled, this is a
     * broken local state (a Keystore fault, or a genuinely revoked key
     * that recovery correctly refused) that needs to be visible to an
     * operator, never silently treated as an automatic de-enrollment. */
    private suspend fun markCredentialMissingIfEnrolled(step: String) {
        if (appPreferences.isEnrolledSnapshot()) {
            android.util.Log.w(LOG_TAG, "$step: enrolled but no local device identity is usable")
            appPreferences.setCredentialMissingLocally(true)
        }
    }

    /** The explicit, operator-initiated recovery for the state above —
     * never called automatically by a sync path. Exposed to the
     * diagnostics screen as "Reativar este tablet" once
     * [AppPreferences.credentialMissingLocally] has been showing true for
     * a while and the operator has confirmed the tablet really does need a
     * new activation code. Clears local device/enrollment state only —
     * the Keystore key itself is left alone, so a fresh [enroll] call
     * reuses it instead of generating (and needing to re-register) a new
     * one. */
    suspend fun reenrollAfterCredentialLoss() {
        deviceStateDao.clear()
        appPreferences.setEnrolled(false)
        appPreferences.setCredentialMissingLocally(false)
    }

    private suspend fun queuePendingHeartbeat(
        batteryLevel: Int?,
        networkType: String,
        storageFreeBytes: Long?,
        clientEventId: UUID,
    ) {
        pendingEventDao.insert(
            PendingEventEntity(
                clientEventId = clientEventId.toString(),
                batteryLevel = batteryLevel,
                networkType = networkType,
                storageFreeBytes = storageFreeBytes,
                appVersion = BuildConfig.VERSION_NAME,
                deviceTimeMillis = System.currentTimeMillis(),
                createdAt = System.currentTimeMillis(),
            ),
        )
    }

    /** Logs only the operation name and the exception's own class — never a
     * message, cause, stack trace, request/response body, activation code
     * or device key material. [DeviceApiError] messages already come
     * straight from the server, so even they aren't safe to log verbatim
     * here. */
    private fun logFailure(step: String, error: Throwable) {
        android.util.Log.w(LOG_TAG, "$step failed: ${error::class.simpleName}")
    }

    private companion object {
        const val LOG_TAG = "MaxcarDeviceRepo"
        const val KEY_ALGORITHM = "ECDSA_P256_SHA256"
        val RETENTION_MILLIS = TimeUnit.DAYS.toMillis(7)
    }
}
