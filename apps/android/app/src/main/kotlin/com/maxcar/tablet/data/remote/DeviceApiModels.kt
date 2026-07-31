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
)

@Serializable
data class HeartbeatResponse(
    val deviceId: String,
    val deviceCode: String,
    val recordedAt: String,
)

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
