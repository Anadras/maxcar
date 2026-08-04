package com.maxcar.tablet.ui.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.maxcar.tablet.data.local.DeviceStateEntity
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
import com.maxcar.tablet.geo.GeoEngine
import com.maxcar.tablet.geo.GeoStatus
import com.maxcar.tablet.work.DeviceTelemetry
import com.maxcar.tablet.work.DeviceWorkScheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

enum class ConnectionCheckStatus { IDLE, CHECKING, OK, FAILED }

data class DeviceHomeUiState(
    val deviceState: DeviceStateEntity? = null,
    val remoteConfig: RemoteConfigEntity? = null,
    val connectionCheck: ConnectionCheckStatus = ConnectionCheckStatus.IDLE,
    val connectionCheckMessage: String? = null,
    val readyMediaCount: Int = 0,
    val geoStatus: GeoStatus = GeoStatus(),
    val credentialMissingLocally: Boolean = false,
)

class DeviceHomeViewModel(
    private val repository: DeviceRepository,
    private val mediaDownloadManager: MediaDownloadManager,
    private val appContext: Context,
    private val telemetryProvider: () -> DeviceTelemetry,
    private val geoEngine: GeoEngine,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeviceHomeUiState())
    val uiState: StateFlow<DeviceHomeUiState> = _uiState.asStateFlow()

    init {
        combine(
            repository.deviceState,
            repository.remoteConfig,
            mediaDownloadManager.readyPlaylist,
            geoEngine.status,
            repository.credentialMissingLocally,
        ) { state, config, ready, geoStatus, credentialMissing ->
            Data5(state, config, ready.size, geoStatus, credentialMissing)
        }
            .onEach { data ->
                _uiState.value = _uiState.value.copy(
                    deviceState = data.state,
                    remoteConfig = data.config,
                    readyMediaCount = data.readyCount,
                    geoStatus = data.geoStatus,
                    credentialMissingLocally = data.credentialMissing,
                )
            }.launchIn(viewModelScope)
    }

    /** Explicit, operator-confirmed recovery from a broken local
     * credential (MAX-011 Bloco A) — never triggered automatically. Sends
     * the tablet back to the enrollment screen for a fresh code. */
    fun reactivateAfterCredentialLoss() {
        viewModelScope.launch { repository.reenrollAfterCredentialLoss() }
    }

    /** Dev-only simulated GEO test (MAX-008 item 20): feeds a fake fix
     * through the real state machine/priority queue so the whole GEO path
     * can be exercised on a bench without a car — see DeviceHomeScreen's
     * BuildConfig.DEBUG gate, the only place this is reachable from. */
    fun simulateGeoLocation(latitude: Double, longitude: Double) {
        geoEngine.simulateLocation(latitude, longitude)
    }

    private data class Data5(
        val state: DeviceStateEntity?,
        val config: RemoteConfigEntity?,
        val readyCount: Int,
        val geoStatus: GeoStatus,
        val credentialMissing: Boolean,
    )

    /** "Sincronizar agora" (item 42): triggers an immediate grade sync
     * without waiting for the periodic schedule. */
    fun syncMediaNow() {
        DeviceWorkScheduler.syncNow(appContext)
    }

    /** "Testar conexão agora": an on-demand heartbeat, useful while an
     * installer is standing next to the tablet and wants to confirm it
     * actually reaches the server before driving off. */
    fun checkConnectionNow() {
        _uiState.value = _uiState.value.copy(
            connectionCheck = ConnectionCheckStatus.CHECKING,
            connectionCheckMessage = null,
        )
        viewModelScope.launch {
            val telemetry = telemetryProvider()
            val result = repository.sendHeartbeat(
                batteryLevel = telemetry.batteryLevel,
                networkType = telemetry.networkType,
                storageFreeBytes = telemetry.storageFreeBytes,
            )
            _uiState.value = result.fold(
                onSuccess = {
                    _uiState.value.copy(
                        connectionCheck = ConnectionCheckStatus.OK,
                        connectionCheckMessage = "Conectado. Heartbeat enviado com sucesso.",
                    )
                },
                onFailure = {
                    _uiState.value.copy(
                        connectionCheck = ConnectionCheckStatus.FAILED,
                        connectionCheckMessage = "Sem conexão com o servidor no momento.",
                    )
                },
            )
        }
    }

    class Factory(
        private val repository: DeviceRepository,
        private val mediaDownloadManager: MediaDownloadManager,
        private val appContext: Context,
        private val telemetryProvider: () -> DeviceTelemetry,
        private val geoEngine: GeoEngine,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            DeviceHomeViewModel(repository, mediaDownloadManager, appContext, telemetryProvider, geoEngine) as T
    }
}
