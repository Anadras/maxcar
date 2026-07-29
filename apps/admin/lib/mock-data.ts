import type { QueueItem } from '@maxcar/shared';

export const initialQueue: QueueItem[] = [
  {
    id: 'midiamax',
    title: 'Institucional Midiamax',
    kind: 'regular',
    durationSeconds: 15,
  },
  {
    id: 'editorial',
    title: 'Conteúdo editorial',
    kind: 'regular',
    durationSeconds: 20,
  },
  {
    id: 'general',
    title: 'Campanha geral',
    kind: 'regular',
    durationSeconds: 15,
  },
  {
    id: 'news',
    title: 'Notícias da cidade',
    kind: 'regular',
    durationSeconds: 20,
  },
];

export const geoCampaign: QueueItem = {
  id: 'geo-pizza',
  title: 'Oferta Pizzaria Central',
  kind: 'geo',
  durationSeconds: 15,
};
