package com.maxcar.tablet.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.maxcar.tablet.BuildConfig

@Composable
fun DeviceHomeScreen(viewModel: DeviceHomeViewModel, onBackToPlayer: () -> Unit = {}) {
    val state by viewModel.uiState.collectAsState()
    val deviceState = state.deviceState

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("MAXCAR", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            text = deviceState?.deviceCode ?: "Tablet",
            style = MaterialTheme.typography.displaySmall,
        )

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        InfoRow("Estado", "Ativado")
        InfoRow(
            "Servidor",
            when (state.connectionCheck) {
                ConnectionCheckStatus.OK -> "Conectado"
                ConnectionCheckStatus.FAILED -> "Offline"
                ConnectionCheckStatus.CHECKING -> "Verificando…"
                ConnectionCheckStatus.IDLE -> "Não verificado nesta sessão"
            },
        )
        InfoRow("Veículo", deviceState?.vehicleCode ?: "Sem vínculo")
        InfoRow("Última sincronização", deviceState?.lastSyncAt ?: "Nunca")
        InfoRow("Último heartbeat", deviceState?.lastHeartbeatAt ?: "Nunca")
        InfoRow("Versão do app", BuildConfig.VERSION_NAME)
        state.remoteConfig?.let { config ->
            InfoRow("Versão da configuração", config.configVersion.toString())
        }
        InfoRow("Mídias prontas", state.readyMediaCount.toString())

        state.connectionCheckMessage?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 16.dp),
            )
        }

        Button(
            onClick = viewModel::checkConnectionNow,
            enabled = state.connectionCheck != ConnectionCheckStatus.CHECKING,
            modifier = Modifier.padding(top = 24.dp),
        ) {
            Text("Testar conexão agora")
        }
        Button(onClick = viewModel::syncMediaNow) {
            Text("Sincronizar agora")
        }
        Button(onClick = onBackToPlayer) {
            Text("Voltar ao player")
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(text = value, style = MaterialTheme.typography.bodyLarge)
    }
}
