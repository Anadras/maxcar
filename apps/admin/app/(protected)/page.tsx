import {
  DashboardView,
  type DashboardMetricGroup,
} from '@/components/dashboard-view';
import { getDashboardCounts } from '@/lib/data/dashboard';

export default async function DashboardPage() {
  const counts = await getDashboardCounts();
  const metricGroups: DashboardMetricGroup[] = [
    {
      title: 'Comercial',
      metrics: [
        {
          label: 'Clientes reais',
          value: counts.advertisers.toLocaleString('pt-BR'),
          detail: 'Ver clientes',
          tone: 'blue',
          href: '/clientes',
        },
        {
          label: 'Estabelecimentos',
          value: counts.establishments.toLocaleString('pt-BR'),
          detail: 'Ver estabelecimentos',
          tone: 'green',
          href: '/estabelecimentos',
        },
        {
          label: 'Campanhas ativas',
          value: counts.activeCampaigns.toLocaleString('pt-BR'),
          detail: 'Ver campanhas ativas',
          tone: 'cyan',
          href: '/campanhas?status=active',
        },
        {
          label: 'Campanhas GEO',
          value: counts.geoCampaigns.toLocaleString('pt-BR'),
          detail: 'Ver campanhas GEO',
          tone: 'cyan',
          href: '/campanhas?type=geo',
        },
      ],
    },
    {
      title: 'Frota',
      metrics: [
        {
          label: 'Motoristas ativos',
          value: counts.activeDrivers.toLocaleString('pt-BR'),
          detail: 'Ver motoristas',
          tone: 'green',
          href: '/motoristas?status=active',
        },
        {
          label: 'Veículos ativos',
          value: counts.activeVehicles.toLocaleString('pt-BR'),
          detail: 'Ver veículos',
          tone: 'green',
          href: '/veiculos?status=active',
        },
      ],
    },
    {
      title: 'Saúde do sistema',
      metrics: [
        {
          label: 'Tablets online',
          value: counts.deviceCounts.online.toLocaleString('pt-BR'),
          detail: `${counts.deviceCounts.total} monitorados`,
          tone: 'green',
          href: '/dispositivos?connection=online',
        },
        {
          label: 'Tablets em atenção',
          value: counts.deviceCounts.attention.toLocaleString('pt-BR'),
          detail: 'Heartbeat entre 5 e 15 min',
          tone: 'yellow',
          href: '/dispositivos?connection=attention',
        },
        {
          label: 'Dispositivos offline',
          value: counts.deviceCounts.offline.toLocaleString('pt-BR'),
          detail: 'Sem sinal há mais de 15 min',
          tone: 'red',
          href: '/dispositivos?connection=offline',
        },
      ],
    },
  ];
  return <DashboardView metricGroups={metricGroups} devices={counts.devices} />;
}
