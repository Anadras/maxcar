import type { Campaign, QueueItem } from '@maxcar/shared';

export const dashboardMetrics = [
  {
    label: 'Veículos cadastrados',
    value: '48',
    detail: '+6 neste mês',
    tone: 'blue',
  },
  {
    label: 'Veículos online',
    value: '41',
    detail: '85,4% da frota',
    tone: 'green',
  },
  {
    label: 'Dispositivos offline',
    value: '3',
    detail: 'Requer atenção',
    tone: 'red',
  },
  {
    label: 'Campanhas ativas',
    value: '18',
    detail: '7 campanhas GEO',
    tone: 'cyan',
  },
  {
    label: 'Reproduções hoje',
    value: '12.847',
    detail: '+18,2% vs. ontem',
    tone: 'blue',
  },
  {
    label: 'Disponibilidade',
    value: '98,7%',
    detail: 'Últimas 24 horas',
    tone: 'green',
  },
] as const;

export const campaigns: Campaign[] = [
  {
    id: 'CMP-041',
    name: 'Oferta Pizzaria Central',
    client: 'Pizzaria Central',
    type: 'GEO',
    status: 'Ativa',
    period: '15 Jul — 15 Ago',
    plays: 1842,
  },
  {
    id: 'CMP-038',
    name: 'Institucional Midiamax',
    client: 'Midiamax',
    type: 'GRADE',
    status: 'Ativa',
    period: 'Contínua',
    plays: 5621,
  },
  {
    id: 'CMP-037',
    name: 'Plano Verão Prime',
    client: 'Academia Prime',
    type: 'GEO',
    status: 'Ativa',
    period: '01 Jul — 31 Ago',
    plays: 932,
  },
  {
    id: 'CMP-035',
    name: 'Feirão Max Motors',
    client: 'Max Motors',
    type: 'GRADE',
    status: 'Agendada',
    period: '01 Ago — 18 Ago',
    plays: 0,
  },
  {
    id: 'CMP-031',
    name: 'Doe Sangue, Salve Vidas',
    client: 'Instituto Vida',
    type: 'GRADE',
    status: 'Pausada',
    period: '01 Jun — 31 Jul',
    plays: 3218,
  },
];

export const vehicles = [
  ['CAR-001', 'Carlos Mendes', 'TB-001', 'Agora', 'Online'],
  ['CAR-002', 'Ana Souza', 'TB-002', '1 min', 'Online'],
  ['CAR-003', 'Roberto Lima', 'TB-003', '4 min', 'Online'],
  ['CAR-004', 'Marina Costa', 'TB-004', '42 min', 'Offline'],
  ['CAR-005', 'Paulo Santos', '—', '2 dias', 'Sem dispositivo'],
  ['CAR-006', 'Juliana Alves', 'TB-006', '12 min', 'Manutenção'],
];

export const drivers = [
  ['Carlos Mendes', 'CAR-001', 'Em operação', '06h 42m', 'Disponível', 'Agora'],
  ['Ana Souza', 'CAR-002', 'Em operação', '05h 18m', 'Disponível', '1 min'],
  ['Roberto Lima', 'CAR-003', 'Pausa', '04h 55m', 'Indisponível', '4 min'],
  ['Marina Costa', 'CAR-004', 'Offline', '02h 10m', 'Indisponível', '42 min'],
  ['Paulo Santos', 'CAR-005', 'Inativo', '—', 'Indisponível', '2 dias'],
];

export const devices = [
  [
    'TB-001',
    'CAR-001',
    'Online',
    '87%',
    'Saudável',
    'Sincronizado',
    '1.0.0',
    'Agora',
  ],
  [
    'TB-002',
    'CAR-002',
    'Online',
    '64%',
    'Saudável',
    'Sincronizado',
    '1.0.0',
    '1 min',
  ],
  [
    'TB-003',
    'CAR-003',
    'Online',
    '32%',
    'Saudável',
    'Pendente',
    '0.9.8',
    '4 min',
  ],
  [
    'TB-004',
    'CAR-004',
    'Offline',
    '—',
    'Sem sinal',
    'Há 42 min',
    '1.0.0',
    '42 min',
  ],
  [
    'TB-006',
    'CAR-006',
    'Atenção',
    '18%',
    'Instável',
    'Pendente',
    '0.9.8',
    '12 min',
  ],
];

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
