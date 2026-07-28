export type CampaignType = 'GRADE' | 'GEO';
export type OperationalStatus = 'Online' | 'Offline' | 'Atenção' | 'Manutenção';

export interface QueueItem {
  id: string;
  title: string;
  kind: 'regular' | 'geo';
  durationSeconds: number;
}

export interface Campaign {
  id: string;
  name: string;
  client: string;
  type: CampaignType;
  status: 'Ativa' | 'Agendada' | 'Pausada';
  period: string;
  plays: number;
}
