'use client';

import { useFormStatus } from 'react-dom';

export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingLabel = 'Enviando…',
  className = 'button button-primary',
}: {
  children: React.ReactNode;
  confirmMessage: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
