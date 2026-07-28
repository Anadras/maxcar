import {
  DashboardView,
  type DashboardMetric,
} from '@/components/dashboard-view';
import { getDashboardCounts } from '@/lib/data/dashboard';

export default async function DashboardPage() {
  const counts = await getDashboardCounts();
  const metrics: DashboardMetric[] = [
    {
      label: 'Clientes reais',
      value: counts.advertisers.toLocaleString('pt-BR'),
      detail: 'Supabase · advertisers',
      tone: 'blue',
    },
    {
      label: 'Estabelecimentos',
      value: counts.establishments.toLocaleString('pt-BR'),
      detail: 'Pontos PostGIS',
      tone: 'green',
    },
    {
      label: 'Campanhas ativas',
      value: counts.activeCampaigns.toLocaleString('pt-BR'),
      detail: 'Estrutura validada',
      tone: 'cyan',
    },
    {
      label: 'Campanhas GEO',
      value: counts.geoCampaigns.toLocaleString('pt-BR'),
      detail: 'Ativações cadastradas',
      tone: 'cyan',
    },
    {
      label: 'Veículos online',
      value: '41',
      detail: 'Demonstrativo até MAX-005',
      tone: 'green',
    },
    {
      label: 'Dispositivos offline',
      value: '3',
      detail: 'Demonstrativo até MAX-005',
      tone: 'red',
    },
  ];
  return <DashboardView dashboardMetrics={metrics} />;
}
