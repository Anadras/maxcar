package com.maxcar.tablet.ui.enrollment

import com.maxcar.tablet.domain.DeviceApiError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.IOException

/**
 * MAX-010.6 follow-up: a real field failure (an enrollment code expiring
 * during a slow activation) was indistinguishable, on screen, from a
 * genuinely invalid code — both showed the same generic "Código inválido
 * ou já utilizado." This locks down that each rejection reason now has its
 * own distinct copy, so that regression can't come back silently.
 */
class EnrollmentViewModelMessagesTest {

    @Test
    fun `each enrollment-code rejection reason has its own message`() {
        val notFound = friendlyMessage(DeviceApiError.EnrollmentCodeNotFound("x"))
        val expired = friendlyMessage(DeviceApiError.EnrollmentCodeExpired("x"))
        val alreadyUsed = friendlyMessage(DeviceApiError.EnrollmentCodeAlreadyUsed("x"))
        val revoked = friendlyMessage(DeviceApiError.EnrollmentCodeRevoked("x"))
        val attemptExpired = friendlyMessage(DeviceApiError.EnrollmentAttemptExpired("x"))
        val invalidSignature = friendlyMessage(DeviceApiError.InvalidSignature("x"))

        val messages = listOf(notFound, expired, alreadyUsed, revoked, attemptExpired, invalidSignature)
        assertEquals(
            "every rejection reason must produce a distinct message",
            messages.size,
            messages.toSet().size,
        )
    }

    @Test
    fun `a code not found says so, not generic invalid`() {
        assertEquals(
            "Código não encontrado. Confira se foi digitado corretamente.",
            friendlyMessage(DeviceApiError.EnrollmentCodeNotFound("Enrollment code not found.")),
        )
    }

    @Test
    fun `an expired code tells the operator to request a new one`() {
        val message = friendlyMessage(DeviceApiError.EnrollmentCodeExpired("Enrollment code has expired."))
        assertEquals("Código expirado. Peça um novo código no painel.", message)
    }

    @Test
    fun `a network failure is never presented as an invalid code`() {
        val message = friendlyMessage(DeviceApiError.NetworkUnavailable(IOException("boom")))
        assertEquals("Sem conexão. Verifique a rede do tablet.", message)
        assertNotEquals("Código inválido ou já utilizado.", message)
    }

    @Test
    fun `a server error is never presented as an invalid code`() {
        val message = friendlyMessage(DeviceApiError.ServerError("Unexpected error (HTTP 500)."))
        assertEquals("Servidor indisponível. Tente novamente em instantes.", message)
        assertNotEquals("Código inválido ou já utilizado.", message)
    }

    @Test
    fun `too many attempts is never presented as an invalid code`() {
        val message = friendlyMessage(DeviceApiError.RateLimited("Too many enrollment attempts."))
        assertEquals("Muitas tentativas. Aguarde alguns minutos.", message)
        assertNotEquals("Código inválido ou já utilizado.", message)
    }

    @Test
    fun `a signature failure is distinct from a code rejection`() {
        val message = friendlyMessage(DeviceApiError.InvalidSignature("Invalid proof of possession."))
        assertEquals("Falha ao confirmar a identidade do tablet. Tente novamente.", message)
        assertNotEquals("Código inválido ou já utilizado.", message)
    }

    @Test
    fun `a local Keystore failure is never presented as an invalid code`() {
        // Not a DeviceApiError at all — exactly what DeviceKeyStore.getOrCreateKeyInfo()/sign()
        // throw on a real Keystore fault, since those calls happen before
        // any network request in DeviceRepository.enroll().
        val message = friendlyMessage(IllegalStateException("No device key present to sign with."))
        assertEquals("Falha ao preparar a identidade segura do tablet. Tente novamente.", message)
        assertNotEquals("Código inválido ou já utilizado.", message)
    }
}
