import type { Database } from '@maxcar/shared/database-types';
import { ConfirmSubmitButton } from './confirm-submit-button';
import { StatusBadge } from './ui';

type ProcessingJob = Pick<
  Database['public']['Tables']['media_processing_jobs']['Row'],
  | 'id'
  | 'creative_id'
  | 'media_version'
  | 'status'
  | 'attempts'
  | 'max_attempts'
  | 'last_error'
  | 'created_at'
  | 'completed_at'
>;

type Creative = Database['public']['Tables']['campaign_creatives']['Row'] & {
  signedUrl: string | null;
  processingHistory: ProcessingJob[];
};

const PROCESSING_STATUS_LABELS: Record<
  Creative['processing_status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  uploaded: { label: 'Enviado', tone: 'warning' },
  queued: { label: 'Na fila', tone: 'warning' },
  processing: { label: 'Processando', tone: 'warning' },
  probing: { label: 'Analisando', tone: 'warning' },
  transcoding: { label: 'Convertendo', tone: 'warning' },
  validating_output: { label: 'Validando', tone: 'warning' },
  ready: { label: 'Compatível', tone: 'success' },
  incompatible: { label: 'Incompatível', tone: 'danger' },
  failed: { label: 'Erro', tone: 'danger' },
};

function ProcessingStatusBadge({ creative }: { creative: Creative }) {
  const status = PROCESSING_STATUS_LABELS[creative.processing_status];
  return (
    <span
      className={`badge badge-${status.tone}`}
      title={creative.processing_error ?? undefined}
    >
      {status.label}
    </span>
  );
}

interface FfprobeStreamLike {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}
interface FfprobeResultLike {
  format?: { duration?: string; format_name?: string };
  streams?: FfprobeStreamLike[];
}

function parseFps(rFrameRate: string | undefined): string | null {
  if (!rFrameRate) return null;
  const [num, den] = rFrameRate.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
}

function TechnicalDiagnostics({ creative }: { creative: Creative }) {
  const probe = (creative.processed_media_probe ??
    creative.media_probe) as FfprobeResultLike | null;
  if (!probe) {
    return (
      <p className="muted-text" style={{ fontSize: 11 }}>
        Nenhum dado técnico disponível ainda — o arquivo ainda não foi
        analisado pelo pipeline.
      </p>
    );
  }
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const audio = probe.streams?.find((s) => s.codec_type === 'audio');
  const source = creative.processed_media_probe
    ? 'Derivado processado'
    : 'Arquivo original (ainda sem derivado)';

  return (
    <dl className="diagnostics-grid">
      <div>
        <dt>Fonte</dt>
        <dd>{source}</dd>
      </div>
      <div>
        <dt>Codec de vídeo</dt>
        <dd>{video?.codec_name ?? '—'}</dd>
      </div>
      <div>
        <dt>Profile</dt>
        <dd>{video?.profile ?? '—'}</dd>
      </div>
      <div>
        <dt>Pixel format</dt>
        <dd>{video?.pix_fmt ?? '—'}</dd>
      </div>
      <div>
        <dt>Resolução</dt>
        <dd>{video?.width && video?.height ? `${video.width}×${video.height}` : '—'}</dd>
      </div>
      <div>
        <dt>FPS</dt>
        <dd>{parseFps(video?.r_frame_rate) ?? '—'}</dd>
      </div>
      <div>
        <dt>Áudio</dt>
        <dd>{audio?.codec_name ?? 'Sem áudio'}</dd>
      </div>
      <div>
        <dt>Duração</dt>
        <dd>{probe.format?.duration ? `${Number(probe.format.duration).toFixed(1)}s` : '—'}</dd>
      </div>
      {creative.processing_error && (
        <div className="full-field">
          <dt>Erro</dt>
          <dd>{creative.processing_error}</dd>
        </div>
      )}
    </dl>
  );
}

function ProcessingHistory({ history }: { history: ProcessingJob[] }) {
  if (history.length === 0) {
    return (
      <p className="muted-text" style={{ fontSize: 11 }}>
        Nenhuma tentativa de processamento registrada.
      </p>
    );
  }
  return (
    <ul className="processing-history">
      {history.map((job) => (
        <li key={job.id}>
          <span className={`badge badge-${job.status === 'ready' ? 'success' : job.status === 'incompatible' || job.status === 'failed' ? 'danger' : 'warning'}`}>
            v{job.media_version} · {job.status}
          </span>
          <small>
            {job.attempts}/{job.max_attempts} tentativa(s)
            {job.last_error ? ` · ${job.last_error}` : ''}
          </small>
          <time>
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(job.created_at),
            )}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function CreativeGallery({
  creatives,
  canWrite,
  toggleAction,
  reprocessAction,
}: {
  creatives: Creative[];
  canWrite: boolean;
  toggleAction: (creativeId: string, active: boolean) => Promise<void>;
  reprocessAction: (creativeId: string) => Promise<void>;
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
              <ProcessingStatusBadge creative={creative} />
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

            <details className="creative-diagnostics">
              <summary>Diagnóstico técnico</summary>
              <TechnicalDiagnostics creative={creative} />
            </details>

            {creative.processingHistory.length > 0 && (
              <details className="creative-diagnostics">
                <summary>Histórico ({creative.processingHistory.length})</summary>
                <ProcessingHistory history={creative.processingHistory} />
              </details>
            )}

            {canWrite && (
              <div className="creative-actions-row">
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
                {(creative.processing_status === 'incompatible' ||
                  creative.processing_status === 'failed') && (
                  <form action={reprocessAction.bind(null, creative.id)}>
                    <button className="text-button" type="submit">
                      Reprocessar
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
