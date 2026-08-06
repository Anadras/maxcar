package com.maxcar.tablet.ui.player

import android.os.SystemClock
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.maxcar.tablet.kiosk.MaintenanceAccessController
import com.maxcar.tablet.kiosk.UnlockResult
import kotlinx.coroutines.launch

/**
 * The only path into diagnostics/maintenance mode (MAX-010): the hidden
 * corner gesture ([PlayerScreen]) opens this, never diagnostics directly.
 * Owns nothing beyond the current text field and error message — all real
 * state (attempt count, lockout) lives in [MaintenanceAccessController],
 * so it survives this dialog being dismissed and reopened.
 */
@Composable
fun MaintenancePinDialog(
    controller: MaintenanceAccessController,
    onDismiss: () -> Unit,
    onUnlocked: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Acesso técnico") },
        text = {
            Column {
                Text("Digite o PIN de manutenção do dispositivo (6 dígitos).")
                OutlinedTextField(
                    value = pin,
                    onValueChange = { value ->
                        if (value.length <= 6 && value.all(Char::isDigit)) pin = value
                    },
                    modifier = Modifier.padding(top = 12.dp),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                )
                message?.let {
                    Text(
                        text = it,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = pin.length == 6 && !checking,
                onClick = {
                    checking = true
                    scope.launch {
                        when (val result = controller.attemptUnlock(pin)) {
                            UnlockResult.Success -> onUnlocked()
                            is UnlockResult.WrongPin -> {
                                message = "PIN incorreto. ${result.remainingAttempts} tentativa(s) restante(s)."
                            }
                            is UnlockResult.LockedOut -> {
                                // result.untilMillis is elapsedRealtime-based
                                // (monotonic), never a wall-clock instant —
                                // show a countdown duration, never a clock time.
                                val remainingSeconds =
                                    ((result.untilMillis - SystemClock.elapsedRealtime()) / 1000)
                                        .coerceAtLeast(0)
                                val minutes = remainingSeconds / 60
                                val seconds = remainingSeconds % 60
                                message = "Bloqueado por tentativas incorretas. " +
                                    "Tente novamente em ${minutes}min ${seconds}s."
                            }
                            UnlockResult.NoPinConfigured -> {
                                message = "PIN não configurado para este dispositivo. Contate o administrador."
                            }
                        }
                        pin = ""
                        checking = false
                    }
                },
            ) { Text("Entrar") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancelar") }
        },
    )
}
