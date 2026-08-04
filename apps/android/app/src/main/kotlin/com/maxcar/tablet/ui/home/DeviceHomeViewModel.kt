package com.maxcar.tablet.ui.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.maxcar.tablet.data.local.DeviceStateEntity
import com.maxcar.tablet.data.local.RemoteConfigEntity
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.data.repository.MediaDownloadManager
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
)

class DeviceHomeViewModel(
    private val repository: DeviceRepository,
    private val mediaDownloadManager: MediaDownloadManager,
    private val appContext: Context,
    private val telemetryProvider: () -> DeviceTelemetry,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeviceHomeUiState())
    val uiState: StateFlow<DeviceHomeUiState> = _uiState.asStateFlow()

    init {
        combine(
            repository.deviceState,
            repository.remoteConfig,
            mediaDownloadManager.readyPlaylist,
        ) { state, config, ready -> Triple(state, config, ready.size) }
            .onEach { (state, config, readyCount) ->
                _uiState.value = _uiState.value.copy(
                    deviceState = state,
                    remoteConfig = config,
                    readyMediaCount = readyCount,
                )
            }.launchIn(viewModelScope)
    }

    /** "Sincronizar agora" (item 42): triggers an immediate grade sync
     * without waiting for the periodic schedule. */
    fun syncMediaNow() {
        DeviceWorkScheduler.syncMediaNow(appContext)
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
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            DeviceHomeViewModel(repository, mediaDownloadManager, appContext, telemetryProvider) as T
    }
}
