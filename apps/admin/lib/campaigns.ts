import type { CampaignStatus, DatabaseCampaignType } from '@maxcar/shared';

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const CAMPAIGN_TYPE_LABELS: Record<DatabaseCampaignType, string> = {
  regular: 'REGULAR',
  geo: 'GEO',
};

export const ACTIVE_DAY_LABELS = [
  'DOM',
  'SEG',
  'TER',
  'QUA',
  'QUI',
  'SEX',
  'SÁB',
] as const;

export function priorityLabel(priority: number) {
  if (priority >= 80) return 'Premium';
  if (priority >= 60) return 'Alta';
  if (priority >= 40) return 'Normal';
  return 'Baixa';
}

export function formatCampaignPeriod(
  startsAt: string | null,
  endsAt: string | null,
) {
  if (!startsAt || !endsAt) return 'Período incompleto';
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return `${formatter.format(new Date(startsAt))} — ${formatter.format(
    new Date(endsAt),
  )}`;
}
