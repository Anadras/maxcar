package com.maxcar.tablet.data.remote

import kotlinx.serialization.Serializable

@Serializable
data class EnrollRequest(
    val code: String,
    val installationId: String,
    val appVersion: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
)

@Serializable
data class EnrollResponse(
    val deviceToken: String,
    val deviceId: String,
    val deviceCode: String,
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
)

@Serializable
data class ApiErrorBody(
    val error: String,
    val message: String? = null,
)
