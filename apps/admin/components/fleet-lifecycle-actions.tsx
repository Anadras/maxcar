'use client';

import { useState } from 'react';
import { ConfirmSubmitButton } from './confirm-submit-button';

type FormAction = (formData: FormData) => void;

export function FleetLifecycleActions({
  entityLabel,
  entityDisplayName,
  isArchived,
  isActive,
  isSuperAdmin,
  canUnlink,
  unlinkLabel,
  archiveAction,
  restoreAction,
  setActiveAction,
  unlinkAction,
  deleteAction,
}: {
  entityLabel: string;
  entityDisplayName: string;
  isArchived: boolean;
  isActive: boolean;
  isSuperAdmin: boolean;
  canUnlink?: boolean;
  unlinkLabel?: string;
  archiveAction: FormAction;
  restoreAction: FormAction;
  setActiveAction: FormAction;
  unlinkAction?: FormAction;
  deleteAction: FormAction;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div className="lifecycle-actions">
      <div className="lifecycle-actions-row">
        {isArchived ? (
          <form action={restoreAction}>
            <button className="button button-secondary" type="submit">
              Restaurar
            </button>
          </form>
        ) : (
          <>
            <form action={setActiveAction}>
              <input
                type="hidden"
                name="active"
                value={isActive ? 'false' : 'true'}
              />
              <button className="button button-secondary" type="submit">
                {isActive ? 'Desativar' : 'Reativar'}
              </button>
            </form>
            <form action={archiveAction}>
              <ConfirmSubmitButton
                className="button button-secondary"
                confirmMessage={`Arquivar "${entityDisplayName}"? Sai das listas principais, mas continua no banco e pode ser restaurado a qualquer momento.`}
                pendingLabel="Arquivando…"
              >
                Arquivar
              </ConfirmSubmitButton>
            </form>
            {canUnlink && unlinkAction && (
              <form action={unlinkAction}>
                <ConfirmSubmitButton
                  className="button button-secondary"
                  confirmMessage={`Desvincular ${unlinkLabel ?? 'o vínculo atual'}?`}
                  pendingLabel="Desvinculando…"
                >
                  Desvincular
                </ConfirmSubmitButton>
              </form>
            )}
          </>
        )}
        {isSuperAdmin && (
          <button
            className="button button-danger"
            type="button"
            onClick={() => setShowDelete((value) => !value)}
          >
            Excluir permanentemente
          </button>
        )}
      </div>

      {isSuperAdmin && showDelete && (
        <form action={deleteAction} className="lifecycle-delete-form">
          <p className="lifecycle-delete-warning">
            O MAXCAR está em modo piloto. Esta ação apaga permanentemente este{' '}
            {entityLabel} e os dados de teste relacionados, mas mantém um
            registro da exclusão na auditoria. Não é possível desfazer.
          </p>
          <label>
            Sua senha atual
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            Motivo da exclusão
            <textarea name="reason" required rows={2} />
          </label>
          <label>
            Digite EXCLUIR para confirmar
            <input
              type="text"
              name="confirmText"
              required
              placeholder="EXCLUIR"
            />
          </label>
          <div className="lifecycle-delete-form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setShowDelete(false)}
            >
              Cancelar
            </button>
            <ConfirmSubmitButton
              className="button button-danger"
              confirmMessage={`Excluir permanentemente "${entityDisplayName}"? Não é possível desfazer.`}
              pendingLabel="Excluindo…"
            >
              Excluir permanentemente
            </ConfirmSubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
