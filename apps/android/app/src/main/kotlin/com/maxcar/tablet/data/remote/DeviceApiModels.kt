package com.maxcar.tablet.data.remote

import kotlinx.serialization.Serializable

// --- MAX-010.6: cryptographic device identity (enrollment & recovery) ---

@Serializable
data class EnrollKeyStartRequest(
    val code: String,
    val installationId: String,
    val publicKey: String,
    val publicKeyFingerprint: String,
    val algorithm: String,
    val hardwareBacked: Boolean? = null,
    val appVersion: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
)

@Serializable
data class EnrollKeyStartResponse(
    val enrollmentAttemptId: String,
    val challenge: String,
    val expiresAt: String,
)

@Serializable
data class EnrollKeyCompleteRequest(
    val enrollmentAttemptId: String,
    val signature: String,
)

@Serializable
data class EnrollKeyCompleteResponse(
    val deviceId: String,
    val deviceCode: String,
    val keyId: String,
    val vehicleId: String? = null,
    val vehicleCode: String? = null,
)

@Serializable
data class RecoverKeyStartRequest(val publicKeyFingerprint: String)

@Serializable
data class RecoverKeyStartResponse(
    val recoveryAttemptId: String,
    val challenge: String,
    val expiresAt: String,
)

@Serializable
data class RecoverKeyCompleteRequest(
    val recoveryAttemptId: String,
    val signature: String,
)

@Serializable
data class RecoverKeyCompleteResponse(
    val deviceId: String,
    val deviceCode: String,
    val keyId: String,
    val vehicleId: String? = null,
    val vehicleCode: String? = null,
)

@Serializable
data class HeartbeatRequest(
    val batteryLevel: Int? = null,
    val networkType: String,
    val storageFreeBytes: Long? = null,
    val appVersion: String,
    val deviceTime: String,
    val clientEventId: String,
    // Player-state summary, optional and additive (MAX-007): omitting them
    // keeps this the exact MAX-006 heartbeat shape.
    val playerState: String? = null,
    val mediaReadyCount: Int? = null,
    val manifestVersion: String? = null,
    val currentCampaignId: String? = null,
    val currentCreativeId: String? = null,
    val lastError: String? = null,
    // GPS/GEO status (MAX-008), optional and additive for the same reason
    // as the player-state fields above: an older build's heartbeat call
    // still works unchanged.
    val latitude: Double? = null,
    val longitude: Double? = null,
    val gpsAvailable: Boolean = false,
    val locationAccuracyMeters: Double? = null,
    val locationPermissionGranted: Boolean? = null,
    val lastLocationError: String? = null,
    val lastGeofenceEntryAt: String? = null,
    val lastGeoCampaignId: String? = null,
    // Sync/operational status (MAX-009), same additive rule.
    val operationalStatus: String? = null,
    val pendingEventCount: Int? = null,
    val clockSkewSeconds: Int? = null,
    // Kiosk layer actually achieved (MAX-010), same additive rule.
    val kioskLevel: String? = null,
    // MAX-012: how many synced creatives are currently sitting out a
    // watchdog-triggered quarantine — same additive rule as every field
    // above.
    val quarantinedMediaCount: Int? = null,
)

@Serializable
data class HeartbeatResponse(
    val deviceId: String,
    val deviceCode: String,
    val recordedAt: String,
)

@Serializable
data class ManifestPlaylistItem(
    val campaignId: String,
    val creativeId: String,
    val type: String,
    val mimeType: String,
    val durationSeconds: Double,
    val fileSizeBytes: Long? = null,
    val sha256: String? = null,
    val downloadUrl: String? = null,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val position: Int,
)

@Serializable
data class ManifestResponse(
    val manifestVersion: String,
    val generatedAt: String,
    val deviceId: String,
    val playlist: List<ManifestPlaylistItem> = emptyList(),
)

@Serializable
data class PlaybackEventRequest(
    val clientEventId: String,
    val campaignId: String,
    val creativeId: String?,
    val status: String,
    val startedAt: String,
    val completedAt: String? = null,
    val durationMs: Long? = null,
    val completionPercentage: Int? = null,
    val failureReason: String? = null,
    val offline: Boolean = false,
)

@Serializable
data class PlaybackEventsRequest(val events: List<PlaybackEventRequest>)

@Serializable
data class PlaybackEventResult(
    val clientEventId: String,
    val ok: Boolean,
    val recorded: Boolean = false,
)

@Serializable
data class PlaybackEventsResponse(val results: List<PlaybackEventResult> = emptyList())

@Serializable
data class ConfigResponse(
    val deviceId: String,
    val deviceCode: String,
    val vehicleId: String? = null,
    val vehicleCode: String? = null,
    val heartbeatIntervalSeconds: Int,
    val syncIntervalSeconds: Int,
    val kioskEnabled: Boolean,
    val loggingLevel: String,
    val configVersion: Int,
    val maintenancePinHash: String? = null,
    val maintenancePinSalt: String? = null,
    val maintenanceTimeoutSeconds: Int? = null,
)

@Serializable
data class ApiErrorBody(
    val error: String,
    val message: String? = null,
)

// --- MAX-008: GEO rules and geofence transition events ---

@Serializable
data class GeoRuleItem(
    val geofenceId: String,
    val campaignId: String,
    val creativeId: String,
    val establishmentId: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Int,
    val priority: Int,
    val cooldownSeconds: Int,
    // MAX-011: raw wire string ("IMMEDIATE"/"AFTER_CURRENT"/"MAX_WAIT") —
    // parsed defensively by GeoPlaybackMode.from, never trusted blindly.
    val playbackMode: String = "AFTER_CURRENT",
    val maxWaitSeconds: Int = 5,
    val type: String,
    val mimeType: String,
    val durationSeconds: Double,
    val fileSizeBytes: Long? = null,
    val sha256: String? = null,
    val downloadUrl: String? = null,
    val startsAt: String? = null,
    val endsAt: String? = null,
)

@Serializable
data class GeoRulesResponse(
    val rulesVersion: String,
    val generatedAt: String,
    val deviceId: String,
    val rules: List<GeoRuleItem> = emptyList(),
)

@Serializable
data class GeofenceEventRequest(
    val clientEventId: String,
    val geofenceId: String,
    val eventType: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float? = null,
    val distanceMeters: Double? = null,
    val occurredAt: String,
)

@Serializable
data class GeofenceEventsRequest(val events: List<GeofenceEventRequest>)

@Serializable
data class GeofenceEventResult(
    val clientEventId: String,
    val ok: Boolean,
    val recorded: Boolean = false,
)

@Serializable
data class GeofenceEventsResponse(val results: List<GeofenceEventResult> = emptyList())

// --- MAX-009: remote commands ---

@Serializable
data class DeviceCommandItem(
    val commandId: String,
    val commandType: String,
    val createdAt: String,
)

@Serializable
data class DeviceCommandsResponse(val commands: List<DeviceCommandItem> = emptyList())

@Serializable
data class AcknowledgeCommandRequest(
    val commandId: String,
    val status: String,
    val result: String? = null,
)

@Serializable
data class AcknowledgeCommandResponse(val acknowledged: Boolean = false)
