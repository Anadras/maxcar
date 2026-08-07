'use client';

import Link from 'next/link';
import { type ReactNode, useEffect } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="header-actions">{action}</div>}
    </header>
  );
}

export function Button({
  children,
  variant = 'primary',
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      className={`button button-${variant}`}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone =
    normalized.includes('online') ||
    normalized.includes('ativo') ||
    normalized.includes('saudável') ||
    normalized.includes('sincronizado') ||
    normalized.includes('disponível')
      ? 'success'
      : normalized.includes('offline') ||
          normalized.includes('sem ') ||
          normalized.includes('inativo')
        ? 'danger'
        : normalized.includes('geo')
          ? 'geo'
          : 'warning';
  return <span className={`badge badge-${tone}`}>{value}</span>;
}

// MAX-014: player_state has its own explicit tone map rather than
// StatusBadge's substring heuristic — "Sem mídia pronta" would otherwise
// match StatusBadge's "sem " → danger rule and read as a hard failure,
// when no_ready_media is actually a self-healing state the tablet's own
// continuous-recovery loop clears on its own.
const PLAYER_STATE_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  preparing: 'warning',
  buffering: 'warning',
  playing_confirmed: 'success',
  stalled: 'danger',
  recovering: 'warning',
  media_error: 'danger',
  no_ready_media: 'warning',
};

export function PlayerStateBadge({
  playerState,
  label,
}: {
  playerState: string;
  label: string;
}) {
  const tone = PLAYER_STATE_TONE[playerState] ?? 'warning';
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

// MAX-019: same reasoning as PLAYER_STATE_TONE above — StatusBadge's
// substring heuristic would read "Device Owner — quiosque destravado" as
// success (matches "ativo"? no — but a label wording change would
// silently flip the tone with no test catching it). device_owner_locked/
// lock_task are the only genuinely healthy values; the pre-MAX-019 bare
// "device_owner" has no reason detail available, so it's neither claimed
// safe nor flagged dangerous.
const KIOSK_LEVEL_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  device_owner_locked: 'success',
  lock_task: 'success',
  device_owner_unlocked: 'danger',
  maintenance_mode: 'warning',
  no_content_mode: 'warning',
  immersive: 'warning',
  none: 'danger',
  device_owner: 'warning',
};

export function KioskLevelBadge({
  kioskLevel,
  label,
}: {
  kioskLevel: string;
  label: string;
}) {
  const tone = KIOSK_LEVEL_TONE[kioskLevel] ?? 'warning';
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function LiveStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'playing'
      ? 'success'
      : status === 'geo'
        ? 'geo'
        : status === 'offline'
          ? 'danger'
          : 'warning';
  const label =
    status === 'playing'
      ? 'Reproduzindo'
      : status === 'geo'
        ? 'GEO ativo'
        : status === 'fallback'
          ? 'Fallback local'
          : status === 'attention'
            ? 'Atenção'
            : 'Offline';
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'blue',
  href,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="metric-top">
        <span>{label}</span>
        <i aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`metric-card metric-${tone} metric-link`}>
        {content}
      </Link>
    );
  }
  return <article className={`metric-card metric-${tone}`}>{content}</article>;
}

export function SectionCard({
  title,
  subtitle,
  children,
  className = '',
  action,
  id,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`section-card ${className}`}>
      {(title || action) && (
        <header className="section-heading">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function DataTable({
  columns,
  rows,
  onRowClick,
}: {
  columns: string[];
  rows: string[][];
  onRowClick?: (row: string[]) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row[0]}-${index}`}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? 'clickable-row' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (
                  onRowClick &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  onRowClick(row);
                }
              }}
            >
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>
                  {cellIndex === 0 ? (
                    <strong>{cell}</strong>
                  ) : cellIndex === row.length - 1 ? (
                    <StatusBadge value={cell} />
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar modal"
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Toast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span>✓</span>
      {message}
    </div>
  );
}
