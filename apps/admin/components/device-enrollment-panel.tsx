'use client';

import { useActionState } from 'react';
import type { EnrollmentCodeState } from '@/app/(protected)/dispositivos/enrollment-actions';
import { ConfirmSubmitButton } from './confirm-submit-button';
import { StatusBadge } from './ui';

const initialState: EnrollmentCodeState = {};

export function DeviceEnrollmentPanel({
  isEnrolled,
  pendingCodeExpiresAt,
  credentialIssuedAt,
  credentialLastUsedAt,
  generateAction,
  revokeCodeAction,
  revokeCredentialAction,
}: {
  isEnrolled: boolean;
  pendingCodeExpiresAt: string | null;
  credentialIssuedAt: string | null;
  credentialLastUsedAt: string | null;
  generateAction: (
    state: EnrollmentCodeState,
    formData: FormData,
  ) => Promise<EnrollmentCodeState>;
  revokeCodeAction: () => Promise<void>;
  revokeCredentialAction: () => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(
    generateAction,
    initialState,
  );

  const status = isEnrolled
    ? 'Ativado'
    : pendingCodeExpiresAt && new Date(pendingCodeExpiresAt) > new Date()
      ? 'Código pendente'
      : 'Não ativado';

  return (
    <div className="enrollment-panel">
      <div className="enrollment-status">
        <StatusBadge value={status} />
        {isEnrolled && credentialIssuedAt && (
          <span>
            Ativado em{' '}
            {new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(credentialIssuedAt))}
          </span>
        )}
        {isEnrolled && credentialLastUsedAt && (
          <span>
            Última chamada autenticada:{' '}
            {new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(credentialLastUsedAt))}
          </span>
        )}
      </div>

      {state.code ? (
        <div className="enrollment-code-reveal">
          <strong>{state.code}</strong>
          <p>
            Informe este código no tablet. Expira em{' '}
            {new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(state.expiresAt!))}
            . Ele não será exibido novamente.
          </p>
        </div>
      ) : (
        <>
          {state.error && (
            <p className="form-message form-message-error" role="alert">
              {state.error}
            </p>
          )}
          <form action={formAction} className="enrollment-actions">
            <button
              className="button button-secondary"
              type="submit"
              disabled={pending}
            >
              {pending
                ? 'Gerando…'
                : isEnrolled
                  ? 'Gerar novo código (reenrollment)'
                  : 'Gerar código de ativação'}
            </button>
          </form>
        </>
      )}

      <div className="enrollment-actions">
        {!isEnrolled && pendingCodeExpiresAt && (
          <form action={revokeCodeAction}>
            <button className="text-button" type="submit">
              Revogar código pendente
            </button>
          </form>
        )}
        {isEnrolled && (
          <form action={revokeCredentialAction}>
            <ConfirmSubmitButton
              className="text-button"
              confirmMessage="Revogar a credencial deste tablet? Ele deixará de conseguir enviar heartbeats até ser reativado com um novo código."
            >
              Revogar credencial
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
