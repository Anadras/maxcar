'use client';

import { useState } from 'react';
import { ConfirmSubmitButton } from './confirm-submit-button';

type FormAction = (formData: FormData) => void;

export function PilotDeleteAction({
  entityLabel,
  entityName,
  deleteAction,
}: {
  entityLabel: string;
  entityName: string;
  deleteAction: FormAction;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lifecycle-actions">
      <button
        type="button"
        className="button button-danger"
        onClick={() => setOpen((value) => !value)}
      >
        Excluir permanentemente
      </button>
      {open && (
        <form action={deleteAction} className="lifecycle-delete-form">
          <p className="lifecycle-delete-warning">
            O MAXCAR está em modo piloto. Esta ação apaga o {entityLabel} e os
            dados de teste relacionados, mas mantém um registro da exclusão na
            auditoria. Não é possível desfazer.
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
            <input name="confirmText" required placeholder="EXCLUIR" />
          </label>
          <div className="lifecycle-delete-form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
            <ConfirmSubmitButton
              className="button button-danger"
              confirmMessage={`Excluir permanentemente “${entityName}” e os dados de teste relacionados?`}
              pendingLabel="Excluindo…"
            >
              Confirmar exclusão
            </ConfirmSubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
