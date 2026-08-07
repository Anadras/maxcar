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

// MAX-016: one shared vocabulary for "what is this tablet actually doing
// right now", used by Início's "Reproduzindo agora" block and /ao-vivo —
// ONLINE (heartbeat recente) is connectivity; REPRODUZINDO/GEO/FALLBACK/
// ATENÇÃO describe playback, and a device can be online while in any of
// them. Never conflate FALLBACK with OFFLINE — it's still connected and
// self-recovering, just showing local content instead of a commercial.
export const LIVE_STATUS_LABEL: Record<string, string> = {
  playing: 'Reproduzindo',
  geo: 'GEO ativo',
  fallback: 'Fallback local',
  attention: 'Atenção',
  offline: 'Offline',
};

export const LIVE_STATUS_TONE: Record<
  string,
  'success' | 'warning' | 'danger' | 'geo'
> = {
  playing: 'success',
  geo: 'geo',
  fallback: 'warning',
  attention: 'warning',
  offline: 'danger',
};

export type LiveStatus = 'playing' | 'geo' | 'fallback' | 'attention' | 'offline';

/** Derives one primary status per device from the same heartbeat fields
 * already collected (player_state, connection, current vs. last GEO
 * campaign) — no new telemetry, no guessed state. A pure function (no
 * `server-only` import) so both lib/data/live.ts and this file's own
 * tests can use it directly. */
export function classifyLiveStatus(device: {
  connection_status: string;
  player_state: string | null;
  current_campaign_id: string | null;
  last_geo_campaign_id: string | null;
}): LiveStatus {
  if (device.connection_status === 'offline' || device.connection_status === 'inactive') {
    return 'offline';
  }
  if (device.player_state === 'no_ready_media') return 'fallback';
  if (
    device.current_campaign_id &&
    device.last_geo_campaign_id &&
    device.current_campaign_id === device.last_geo_campaign_id
  ) {
    return 'geo';
  }
  if (
    device.connection_status === 'attention' ||
    device.player_state === 'stalled' ||
    device.player_state === 'media_error'
  ) {
    return 'attention';
  }
  if (device.player_state === 'playing_confirmed') return 'playing';
  return 'attention';
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Não registrado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
