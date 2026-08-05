package com.maxcar.tablet.ui.enrollment

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.maxcar.tablet.data.repository.DeviceRepository
import com.maxcar.tablet.domain.DeviceApiError
import com.maxcar.tablet.work.DeviceWorkScheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class EnrollmentUiState(
    val installationId: UUID? = null,
    val code: String = "",
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
)

/** Translates [DeviceApiError] into the exact copy item 30 asks for —
 * never a stack trace, never a raw exception message. Each enrollment-code
 * rejection reason gets its own message (MAX-010.6 follow-up): a generic
 * "código inválido" for every possible cause made a code simply expiring
 * mid-activation indistinguishable from an actual bug, from the operator's
 * side. A [Throwable] that isn't a [DeviceApiError] at all can only come
 * from the local Keystore step ([com.maxcar.tablet.data.local.DeviceKeyStore]),
 * since every network/server outcome is always wrapped as one — that's
 * what the final `else` branch specifically names, rather than folding it
 * into the same generic message as a rejected code. */
internal fun friendlyMessage(error: Throwable): String = when (error) {
    is DeviceApiError.NetworkUnavailable -> "Sem conexão. Verifique a rede do tablet."
    is DeviceApiError.EnrollmentCodeNotFound -> "Código não encontrado. Confira se foi digitado corretamente."
    is DeviceApiError.EnrollmentCodeExpired -> "Código expirado. Peça um novo código no painel."
    is DeviceApiError.EnrollmentCodeAlreadyUsed -> "Código já utilizado. Peça um novo código no painel."
    is DeviceApiError.EnrollmentCodeRevoked -> "Este código não é mais válido. Peça um novo código no painel."
    is DeviceApiError.EnrollmentAttemptExpired -> "A ativação demorou demais e expirou. Tente novamente."
    is DeviceApiError.InvalidSignature -> "Falha ao confirmar a identidade do tablet. Tente novamente."
    is DeviceApiError.EnrollmentInvalid -> "Código inválido ou expirado."
    is DeviceApiError.Unauthorized -> "Código inválido ou já utilizado."
    is DeviceApiError.RateLimited -> "Muitas tentativas. Aguarde alguns minutos."
    is DeviceApiError.ServerError -> "Servidor indisponível. Tente novamente em instantes."
    is DeviceApiError -> "Não foi possível ativar o tablet. Tente novamente."
    else -> "Falha ao preparar a identidade segura do tablet. Tente novamente."
}

class EnrollmentViewModel(
    private val repository: DeviceRepository,
    private val appContext: Context,
    private val onEnrolled: () -> Unit,
) : ViewModel() {

    private val _uiState = MutableStateFlow(EnrollmentUiState())
    val uiState: StateFlow<EnrollmentUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(installationId = repository.installationId())
        }
    }

    fun onCodeChanged(value: String) {
        _uiState.value = _uiState.value.copy(code = value.uppercase().trim(), errorMessage = null)
    }

    fun submit() {
        val code = _uiState.value.code
        if (code.isBlank()) {
            _uiState.value = _uiState.value.copy(errorMessage = "Informe o código de ativação.")
            return
        }
        _uiState.value = _uiState.value.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            val result = repository.enroll(code)
            result.fold(
                onSuccess = {
                    DeviceWorkScheduler.scheduleInitialSync(appContext)
                    _uiState.value = _uiState.value.copy(isSubmitting = false)
                    onEnrolled()
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isSubmitting = false,
                        errorMessage = friendlyMessage(error),
                    )
                },
            )
        }
    }

    class Factory(
        private val repository: DeviceRepository,
        private val appContext: Context,
        private val onEnrolled: () -> Unit,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            EnrollmentViewModel(repository, appContext, onEnrolled) as T
    }
}
