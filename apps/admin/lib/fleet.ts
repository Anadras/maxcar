import type { DeviceConnectionStatus } from '@maxcar/business-rules';

export const CONNECTION_LABEL: Record<DeviceConnectionStatus, string> = {
  online: 'Online',
  attention: 'Atenção',
  offline: 'Offline',
  inactive: 'Inativo',
};

// MAX-012 item 14: the raw player_state the Android app reports is a
// richer vocabulary than a plain "playing"/"empty" pair — never shown
// unlabeled. Shared between the devices list (dashboard alert) and the
// device detail page, so the two never drift out of sync.
export const PLAYER_STATE_LABEL: Record<string, string> = {
  preparing: 'Preparando',
  buffering: 'Carregando (buffering)',
  playing_confirmed: 'Reproduzindo (frame confirmado)',
  stalled: 'Travado — watchdog detectou',
  recovering: 'Recuperando',
  media_error: 'Erro de mídia',
  no_ready_media: 'Sem mídia pronta — recuperação automática em andamento',
};

/** MAX-014: a device reporting no_ready_media isn't broken — the tablet's
 * own continuous-recovery loop (PlayerViewModel) keeps retrying on its own
 * every 30s — but it IS dark for passengers right now and worth an
 * operator's attention if it persists, so the dashboard surfaces it
 * distinctly from a hard error. */
export function isStuckOnNoReadyMedia(playerState: string | null): boolean {
  return playerState === 'no_ready_media';
}

export function formatRelativeTime(value: string | null, now = new Date()) {
  if (!value) return 'Nunca';
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 45) return 'Agora';
  if (seconds < 3600) return `Há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Há ${Math.floor(seconds / 3600)} h`;
  return `Há ${Math.floor(seconds / 86400)} d`;
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Não registrado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
