package com.maxcar.tablet.geo

import com.maxcar.tablet.data.local.GeoRuleDao
import com.maxcar.tablet.data.local.GeoRuleEntity
import com.maxcar.tablet.data.local.GeofenceEventDao
import com.maxcar.tablet.data.local.GeofenceEventEntity
import com.maxcar.tablet.data.repository.GeoRulesSyncManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/** Everything the diagnostics screen / heartbeat need to show about GPS and
 * GEO, without ever exposing continuous location to anything beyond this
 * process (MAX-008 item 25). [simulated] marks a status produced by the
 * dev-only simulation tool, never real GPS — must always be visibly
 * flagged wherever shown (item 20). */
data class GeoStatus(
    val permissionGranted: Boolean? = null,
    val active: Boolean = false,
    val lastLatitude: Double? = null,
    val lastLongitude: Double? = null,
    val lastAccuracyMeters: Float? = null,
    val lastUpdateAtMillis: Long? = null,
    val lastGeofenceEntryAtMillis: Long? = null,
    val lastGeofenceEntryEstablishmentId: String? = null,
    val lastGeoCampaignPlayedAtMillis: Long? = null,
    val lastGeoCampaignId: String? = null,
    val lastError: String? = null,
    val simulated: Boolean = false,
    /** How many GEO rules are synced and fully downloaded — zero here
     * (while a real fix should exist) points straight at a sync problem,
     * not a location/distance problem. */
    val readyRuleCount: Int = 0,
    /** The single closest rule to the last known location, whatever its
     * state — this is what answers "why isn't the GEO ad showing" without
     * requiring the operator to understand geofences, cooldowns or the
     * priority queue (MAX-011 Bloco D's on-device GEO diagnostic). */
    val nearestRule: GeoRuleDiagnostic? = null,
)

data class GeoRuleDiagnostic(
    val geofenceId: String,
    val campaignId: String,
    val distanceMeters: Double,
    val radiusMeters: Int,
    val isInside: Boolean,
    val cooldownRemainingSeconds: Long,
)

/**
 * The single coordinator MAX-008 needs: owns the location stream, the
 * offline rule set, the hysteresis state machine and the deterministic
 * priority queue, and exposes exactly one thing the player cares about —
 * [nextCandidate], the best currently-eligible GEO rule, if any. Never
 * pushes playback itself: [com.maxcar.tablet.ui.player.PlayerViewModel]
 * decides *when* it's safe to splice a candidate in (only between items,
 * never interrupting one already playing — item 3).
 */
class GeoEngine(
    private val locationEngine: LocationEngine,
    private val geoRulesSyncManager: GeoRulesSyncManager,
    private val geoRuleDao: GeoRuleDao,
    private val geofenceEventDao: GeofenceEventDao,
    private val scope: CoroutineScope,
) {
    private val stateMachine = GeofenceStateMachine()
    private val enteredAtMillis = mutableMapOf<String, Long>()

    private val _status = MutableStateFlow(GeoStatus())
    val status: StateFlow<GeoStatus> = _status.asStateFlow()

    private val _nextCandidate = MutableStateFlow<GeoRuleEntity?>(null)
    val nextCandidate: StateFlow<GeoRuleEntity?> = _nextCandidate.asStateFlow()

    private var rules: List<GeoRuleEntity> = emptyList()
    private var started = false
    private var rulesCollectorStarted = false

    fun start() {
        if (started) return
        if (!rulesCollectorStarted) {
            rulesCollectorStarted = true
            scope.launch { geoRulesSyncManager.readyRules.collect { rules = it } }
        }

        if (!locationEngine.hasPermission()) {
            _status.value = _status.value.copy(
                permissionGranted = false, active = false, lastError = "permission_denied",
            )
            return
        }
        started = true
        locationEngine.start(
            onLocation = { sample -> onLocation(sample, simulated = false) },
            onError = { error ->
                _status.value = _status.value.copy(active = false, lastError = error)
            },
        )
        _status.value = _status.value.copy(permissionGranted = true, active = true, lastError = null)
    }

    fun stop() {
        started = false
        locationEngine.stop()
        _status.value = _status.value.copy(active = false)
    }

    /**
     * Android may start the player/service before the runtime permission
     * dialog has finished. Re-evaluate immediately after that dialog instead
     * of waiting for an app/service restart. This is essential on a fresh
     * installation: previously GEO could remain inactive for the whole trip
     * even after the operator tapped "Permitir".
     */
    fun refreshLocationPermission() {
        locationEngine.stop()
        started = false
        start()
    }

    /** Dev-only entry point for the simulated-GEO-test tool (MAX-008 item
     * 20): feeds a fake fix through the exact same evaluation path real GPS
     * uses, so the state machine, cooldown and priority queue are tested
     * for real — only [GeoStatus.simulated] and the caller's own
     * debug-build gate distinguish it from a genuine fix. Never wired to
     * anything reachable in a release build; see DeviceHomeScreen. */
    fun simulateLocation(latitude: Double, longitude: Double, accuracyMeters: Float = 5f) {
        onLocation(
            LocationSample(
                latitude = latitude,
                longitude = longitude,
                accuracyMeters = accuracyMeters,
                speedMetersPerSecond = 0f,
                bearingDegrees = 0f,
                timestampMillis = System.currentTimeMillis(),
            ),
            simulated = true,
        )
    }

    private fun onLocation(sample: LocationSample, simulated: Boolean) {
        val now = System.currentTimeMillis()
        val currentRules = rules
        val nearest = currentRules.minByOrNull { stateMachine.distanceTo(it, sample) }
        _status.value = _status.value.copy(
            lastLatitude = sample.latitude,
            lastLongitude = sample.longitude,
            lastAccuracyMeters = sample.accuracyMeters,
            lastUpdateAtMillis = now,
            simulated = simulated,
            readyRuleCount = currentRules.size,
            nearestRule = nearest?.let { rule ->
                val distance = stateMachine.distanceTo(rule, sample)
                val remainingCooldownMs = rule.lastTriggeredAtMillis?.let {
                    (it + rule.cooldownSeconds * 1000L) - now
                } ?: 0L
                GeoRuleDiagnostic(
                    geofenceId = rule.geofenceId,
                    campaignId = rule.campaignId,
                    distanceMeters = distance,
                    radiusMeters = rule.radiusMeters,
                    isInside = distance <= rule.radiusMeters,
                    cooldownRemainingSeconds = (remainingCooldownMs / 1000).coerceAtLeast(0),
                )
            },
        )

        val transitions = stateMachine.evaluate(currentRules, sample, now)
        for (transition in transitions) {
            val rule = currentRules.find { it.geofenceId == transition.geofenceId } ?: continue
            if (transition.type == GeofenceStateMachine.TYPE_ENTER) {
                enteredAtMillis[transition.geofenceId] = now
                _status.value = _status.value.copy(
                    lastGeofenceEntryAtMillis = now,
                    lastGeofenceEntryEstablishmentId = rule.establishmentId,
                )
            } else {
                enteredAtMillis.remove(transition.geofenceId)
            }
            scope.launch { queueGeofenceEvent(rule, transition, sample) }
        }

        updateCandidate(currentRules, sample, now)
    }

    private fun updateCandidate(currentRules: List<GeoRuleEntity>, sample: LocationSample, now: Long) {
        val candidates = currentRules.mapNotNull { rule ->
            if (!stateMachine.isInside(rule.geofenceId)) return@mapNotNull null
            val onCooldown = rule.lastTriggeredAtMillis
                ?.let { now - it < rule.cooldownSeconds * 1000L }
                ?: false
            if (onCooldown) return@mapNotNull null
            GeoCandidate(
                rule = rule,
                distanceMeters = stateMachine.distanceTo(rule, sample),
                enteredAtMillis = enteredAtMillis[rule.geofenceId] ?: now,
            )
        }
        _nextCandidate.value = GeoPriorityScorer.selectBestCandidate(candidates)?.rule
    }

    private suspend fun queueGeofenceEvent(
        rule: GeoRuleEntity,
        transition: GeofenceTransition,
        sample: LocationSample,
    ) {
        geofenceEventDao.insert(
            GeofenceEventEntity(
                clientEventId = UUID.randomUUID().toString(),
                geofenceId = rule.geofenceId,
                eventType = transition.type,
                latitude = sample.latitude,
                longitude = sample.longitude,
                accuracyMeters = sample.accuracyMeters,
                distanceMeters = transition.distanceMeters,
                occurredAt = Instant.ofEpochMilli(transition.occurredAtMillis).toString(),
                createdAt = System.currentTimeMillis(),
            ),
        )
    }

    /** Consumes the current candidate exactly once: called by
     * PlayerViewModel right before deciding whether to splice it into the
     * queue, so a second, near-simultaneous read can never claim the same
     * slot. */
    fun consumeCandidate(): GeoRuleEntity? {
        val candidate = _nextCandidate.value
        _nextCandidate.value = null
        return candidate
    }

    /** Called the moment a GEO creative actually *starts* playing — never
     * on mere geofence entry — so the cooldown clock only ever measures
     * from a real play (MAX-008 item 15), persisted in Room so it survives
     * a restart or reboot. */
    suspend fun onGeoPlayed(geofenceId: String, campaignId: String) {
        val now = System.currentTimeMillis()
        geoRuleDao.recordTriggered(geofenceId, now)
        _status.value = _status.value.copy(
            lastGeoCampaignPlayedAtMillis = now,
            lastGeoCampaignId = campaignId,
        )
    }
}
