import { ConfirmSubmitButton } from './confirm-submit-button';
import { StatusBadge } from './ui';

const ALGORITHM_LABEL: Record<string, string> = {
  ECDSA_P256_SHA256: 'Chave criptográfica (EC P-256)',
};

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** MAX-010.6: shows the tablet's cryptographic identity — never the
 * public key itself, never anything private-key-adjacent, just enough for
 * an operator to judge "is this tablet's identity healthy" and act on it.
 * A device with no active key here may still be on the older, static-
 * token method (see the "Ativação do tablet" card above this one) — the
 * two are deliberately shown as separate cards rather than merged, since a
 * device only ever has one or the other active at a time. */
export function DeviceKeyIdentityPanel({
  hasActiveKey,
  hasActiveLegacyToken,
  algorithm,
  hardwareBacked,
  keyActivatedAt,
  keyLastUsedAt,
  revokeAction,
}: {
  hasActiveKey: boolean;
  hasActiveLegacyToken: boolean;
  algorithm: string | null;
  hardwareBacked: boolean | null;
  keyActivatedAt: string | null;
  keyLastUsedAt: string | null;
  revokeAction: () => Promise<void>;
}) {
  if (!hasActiveKey) {
    return (
      <div className="enrollment-panel">
        <div className="enrollment-status">
          <StatusBadge value="Sem identidade por chave" />
        </div>
        <p className="section-hint">
          {hasActiveLegacyToken
            ? 'Este tablet ainda usa o método de autenticação anterior (token estático). Ele passa a usar uma identidade por chave automaticamente na próxima vez que for reativado com um novo código.'
            : 'Este tablet ainda não possui nenhuma identidade ativa — gere um código de ativação acima.'}
        </p>
      </div>
    );
  }

  const activatedAt = formatDateTime(keyActivatedAt);
  const lastUsedAt = formatDateTime(keyLastUsedAt);

  return (
    <div className="enrollment-panel">
      <div className="enrollment-status">
        <StatusBadge value="Ativa" />
        <span>{(algorithm && ALGORITHM_LABEL[algorithm]) ?? algorithm}</span>
        <span>
          {hardwareBacked
            ? 'Protegida por hardware do tablet'
            : 'Protegida por software do tablet'}
        </span>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Identidade preservada desde</dt>
          <dd>{activatedAt ?? 'Não informado'}</dd>
        </div>
        <div>
          <dt>Último uso</dt>
          <dd>{lastUsedAt ?? 'Nunca usada'}</dd>
        </div>
      </dl>
      <div className="enrollment-actions">
        <form action={revokeAction}>
          <ConfirmSubmitButton
            className="text-button"
            confirmMessage="Revogar a identidade criptográfica deste tablet? Ele deixará de conseguir sincronizar até ser reativado com um novo código (ou recuperado automaticamente, se a chave local ainda existir)."
          >
            Revogar identidade
          </ConfirmSubmitButton>
        </form>
      </div>
    </div>
  );
}
