import type { DeviceConnectionStatus } from '@maxcar/business-rules';

export const CONNECTION_LABEL: Record<DeviceConnectionStatus, string> = {
  online: 'Online',
  attention: 'Atenção',
  offline: 'Offline',
  inactive: 'Inativo',
};

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
