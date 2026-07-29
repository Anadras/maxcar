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
      label: 'Motoristas ativos',
      value: counts.activeDrivers.toLocaleString('pt-BR'),
      detail: 'Cadastro operacional',
      tone: 'green',
    },
    {
      label: 'Veículos ativos',
      value: counts.activeVehicles.toLocaleString('pt-BR'),
      detail: 'Frota cadastrada',
      tone: 'green',
    },
    {
      label: 'Tablets online',
      value: counts.deviceCounts.online.toLocaleString('pt-BR'),
      detail: `${counts.deviceCounts.total} monitorados`,
      tone: 'green',
    },
    {
      label: 'Tablets em atenção',
      value: counts.deviceCounts.attention.toLocaleString('pt-BR'),
      detail: 'Heartbeat entre 5 e 15 min',
      tone: 'yellow',
    },
    {
      label: 'Dispositivos offline',
      value: counts.deviceCounts.offline.toLocaleString('pt-BR'),
      detail: 'Sem sinal há mais de 15 min',
      tone: 'red',
    },
  ];
  return <DashboardView dashboardMetrics={metrics} devices={counts.devices} />;
}
