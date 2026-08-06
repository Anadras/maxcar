package com.maxcar.tablet.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import java.time.Instant

@Composable
fun DeviceHomeScreen(
    viewModel: DeviceHomeViewModel,
    onBackToPlayer: () -> Unit = {},
    secondsUntilAutoReturn: Long? = null,
) {
    val state by viewModel.uiState.collectAsState()
    val deviceState = state.deviceState

    // MAX-011 physical finding: this screen's content (device info + GPS/GEO
    // diagnostics + the debug simulation button) is taller than the Black
    // Shark's viewport at its native density, and this Column never
    // scrolled — the lowest controls (including "Voltar ao player" on some
    // states) were physically unreachable by touch. verticalScroll is the
    // real fix; it was previously worked around, when at all, by changing
    // the OS display density, which is not something a technician in the
    // field should ever need to do.
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("MAXCAR", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            text = deviceState?.deviceCode ?: "Tablet",
            style = MaterialTheme.typography.displaySmall,
        )

        // MAX-011: the kiosk lockdown is suspended while this screen is
        // reachable at all — this banner is the "aviso visual" + "contador"
        // the maintenance-exit flow requires, so nobody is surprised when
        // Lock Task silently re-engages.
        if (secondsUntilAutoReturn != null) {
            Text(
                "Modo quiosque temporariamente suspenso. Retorno automático em " +
                    "${secondsUntilAutoReturn}s, ou toque em \"Voltar ao player\".",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        if (state.credentialMissingLocally) {
            Text(
                "Não foi possível ler a credencial deste tablet no armazenamento " +
                    "seguro do aparelho. Isso não significa que a ativação foi " +
                    "revogada — pode ser um problema temporário. Se persistir, " +
                    "reative o tablet abaixo.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            Button(
                onClick = viewModel::reactivateAfterCredentialLoss,
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                ),
            ) {
                Text("Reativar este tablet")
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
        }

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

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
        Text("GPS / GEO", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        val geo = state.geoStatus
        InfoRow(
            "GPS",
            when {
                geo.permissionGranted == false -> "Sem permissão"
                geo.active -> "Ativo"
                else -> "Inativo"
            },
        )
        InfoRow(
            "Última localização",
            if (geo.lastLatitude != null && geo.lastLongitude != null) {
                "%.5f, %.5f%s".format(
                    geo.lastLatitude,
                    geo.lastLongitude,
                    if (geo.simulated) " (SIMULADO)" else "",
                )
            } else {
                "Nenhuma ainda"
            },
        )
        InfoRow(
            "Precisão",
            geo.lastAccuracyMeters?.let { "${it.toInt()} m" } ?: "—",
        )
        InfoRow(
            "Última entrada em geofence",
            geo.lastGeofenceEntryAtMillis?.let { Instant.ofEpochMilli(it).toString() } ?: "Nenhuma",
        )
        InfoRow(
            "Última campanha GEO exibida",
            geo.lastGeoCampaignId ?: "Nenhuma",
        )
        InfoRow("Último erro de localização", geo.lastError ?: "Nenhum")

        Text(
            "Diagnóstico da campanha GEO",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 16.dp),
        )
        InfoRow("Regras GEO sincronizadas", geo.readyRuleCount.toString())
        val nearest = geo.nearestRule
        when {
            geo.readyRuleCount == 0 -> Text(
                "Nenhuma campanha GEO chegou a este tablet ainda. " +
                    "Toque em \"Sincronizar agora\" ou confirme que o " +
                    "tablet tem internet.",
                style = MaterialTheme.typography.bodyMedium,
            )
            nearest == null -> Text(
                "Aguardando a primeira localização do GPS.",
                style = MaterialTheme.typography.bodyMedium,
            )
            else -> {
                InfoRow(
                    "Distância até o local mais próximo",
                    "%.0f m (raio configurado: %d m)".format(
                        nearest.distanceMeters, nearest.radiusMeters,
                    ),
                )
                InfoRow(
                    "Situação",
                    if (nearest.isInside) "Dentro do raio" else "Fora do raio",
                )
                Text(
                    when {
                        !nearest.isInside ->
                            "O tablet está a %.0f m do estabelecimento. O raio configurado é %d m — a campanha entra assim que o tablet chegar mais perto."
                                .format(nearest.distanceMeters, nearest.radiusMeters)
                        nearest.cooldownRemainingSeconds > 0 ->
                            "O tablet está dentro do raio, mas essa campanha já foi exibida recentemente e está em intervalo de espera (faltam %d s)."
                                .format(nearest.cooldownRemainingSeconds)
                        else ->
                            "O tablet está dentro do raio e a campanha está pronta para entrar assim que o anúncio atual terminar."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        if (BuildConfig.DEBUG) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(
                "Simulação de GEO (apenas debug)",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
            )
            Button(
                onClick = { viewModel.simulateGeoLocation(-20.4489, -54.6167) },
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Text("Simular entrada em geofence de teste")
            }
        }

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
