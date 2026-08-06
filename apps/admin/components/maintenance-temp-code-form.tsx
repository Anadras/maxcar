'use client';

import { useState } from 'react';

type GenerateResult =
  { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

export function MaintenanceTempCodeForm({
  generateAction,
}: {
  generateAction: (reason: string) => Promise<GenerateResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<GenerateResult>();

  async function submit(formData: FormData) {
    setBusy(true);
    setResult(undefined);
    const value = String(formData.get('reason') ?? '');
    const generated = await generateAction(value);
    setResult(generated);
    if (generated.ok) setReason('');
    setBusy(false);
  }

  return (
    <form action={submit} className="heartbeat-form">
      <label>
        Motivo do código temporário
        <input
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          placeholder="Ex.: técnico em campo sem o PIN permanente"
          required
          disabled={busy}
        />
      </label>
      <button className="button button-secondary" type="submit" disabled={busy}>
        {busy ? 'Gerando…' : 'Gerar código temporário'}
      </button>
      {result?.ok && (
        <p className="upload-status" role="status">
          Código: <strong>{result.code}</strong> · válido por 5 minutos, uso
          único. Anote agora — ele não será mostrado novamente.
        </p>
      )}
      {result && !result.ok && (
        <p className="upload-error" role="alert">
          {result.error}
        </p>
      )}
    </form>
  );
}
