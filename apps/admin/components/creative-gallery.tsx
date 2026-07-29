import type { Database } from '@maxcar/shared/database-types';
import { ConfirmSubmitButton } from './confirm-submit-button';
import { StatusBadge } from './ui';

type Creative = Database['public']['Tables']['campaign_creatives']['Row'] & {
  signedUrl: string | null;
};

export function CreativeGallery({
  creatives,
  canWrite,
  toggleAction,
}: {
  creatives: Creative[];
  canWrite: boolean;
  toggleAction: (creativeId: string, active: boolean) => Promise<void>;
}) {
  if (creatives.length === 0) {
    return (
      <div className="empty-state compact-empty">
        <span>▣</span>
        <strong>Nenhum criativo enviado</strong>
        <p>A campanha precisa de ao menos um arquivo ativo para ser ativada.</p>
      </div>
    );
  }
  return (
    <div className="creative-grid">
      {creatives.map((creative) => (
        <article className="creative-card" key={creative.id}>
          <div className="creative-preview">
            {creative.signedUrl ? (
              creative.creative_type === 'image' ? (
                <object
                  data={creative.signedUrl}
                  type="image/*"
                  aria-label={`Preview de ${creative.name}`}
                />
              ) : (
                <video controls preload="metadata">
                  <source src={creative.signedUrl} />
                </video>
              )
            ) : (
              <span>Preview temporariamente indisponível</span>
            )}
          </div>
          <div className="creative-info">
            <header>
              <strong>{creative.name}</strong>
              <StatusBadge value={creative.active ? 'Ativo' : 'Inativo'} />
            </header>
            <dl>
              <div>
                <dt>Tipo</dt>
                <dd>{creative.creative_type.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>{creative.duration_seconds}s</dd>
              </div>
              <div>
                <dt>Tamanho</dt>
                <dd>
                  {creative.file_size_bytes
                    ? `${(creative.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
                    : '—'}
                </dd>
              </div>
            </dl>
            <code title={creative.checksum}>
              SHA-256 · {creative.checksum.slice(0, 16)}…
            </code>
            {canWrite && (
              <form
                action={toggleAction.bind(null, creative.id, !creative.active)}
              >
                {creative.active ? (
                  <ConfirmSubmitButton
                    className="text-button"
                    confirmMessage={`Desativar "${creative.name}"? Campanhas ativas que dependem deste criativo como único ativo não poderão ser desativadas se isso deixar a campanha sem criativo.`}
                    pendingLabel="Desativando…"
                  >
                    Desativar com segurança
                  </ConfirmSubmitButton>
                ) : (
                  <button className="text-button" type="submit">
                    Reativar
                  </button>
                )}
              </form>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
