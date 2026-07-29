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

export const reports = [
  ['Institucional Midiamax', 'GRADE', '5.621', '99,2%', '41', 'Julho 2026'],
  ['Oferta Pizzaria Central', 'GEO', '1.842', '98,7%', '28', '15 Jul — 15 Ago'],
  ['Plano Verão Prime', 'GEO', '932', '97,9%', '19', 'Julho — Agosto'],
  ['Doe Sangue, Salve Vidas', 'GRADE', '3.218', '99,5%', '38', 'Junho — Julho'],
];
