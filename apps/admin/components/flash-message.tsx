'use client';

import { useState } from 'react';

export function FlashMessage({
  success,
  error,
}: {
  success?: string;
  error?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (!success && !error)) return null;
  return (
    <div
      className={`flash-message ${error ? 'flash-error' : 'flash-success'}`}
      role={error ? 'alert' : 'status'}
    >
      <span>{error ?? success}</span>
      <button onClick={() => setDismissed(true)} aria-label="Fechar mensagem">
        ×
      </button>
    </div>
  );
}
