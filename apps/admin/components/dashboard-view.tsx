'use client';

import Link from 'next/link';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';

interface DashboardDevice {
  id: string;
  code: string;
  vehicleCode: string | null;
  heartbeatAt: string | null;
  connection: 'online' | 'attention' | 'offline' | 'inactive';
  playerState: string | null;
  mediaReadyCount: number | null;
  operationalStatus: string | null;
  lastError: string | null;
}

interface DashboardCounts {
  advertisers: number;
  establishments: number;
  activeCampaigns: number;
  campaigns: number;
  creatives: number;
  programmedCampaigns: number;
  deviceCounts: {
    total: number;
    online: number;
    attention: number;
    offline: number;
  };
}

function tabletSummary(device: DashboardDevice) {
  if (device.connection === 'offline') return 'Sem contato com o painel';
  if (device.lastError) return 'Precisa de atenção';
  if ((device.mediaReadyCount ?? 0) === 0) return 'Aguardando conteúdo';
  if (device.playerState === 'playing') return 'Reproduzindo normalmente';
  return 'Conteúdo pronto';
}

export function DashboardView({
  counts,
  devices,
}: {
  counts: DashboardCounts;
  devices: DashboardDevice[];
}) {
  const setupSteps = [
    {
      label: 'Cadastrar cliente',
      detail: 'Quem está anunciando',
      done: counts.advertisers > 0,
      href: counts.advertisers > 0 ? '/clientes' : '/clientes/novo',
    },
    {
      label: 'Adicionar estabelecimento',
      detail: 'Onde o cliente está',
      done: counts.establishments > 0,
      href:
        counts.establishments > 0
          ? '/estabelecimentos'
          : '/estabelecimentos/novo',
    },
    {
      label: 'Criar campanha',
      detail: 'Período e tipo de exibição',
      done: counts.campaigns > 0,
      href: counts.campaigns > 0 ? '/campanhas' : '/campanhas/nova',
    },
    {
      label: 'Enviar imagem ou vídeo',
      detail: 'O material que aparece na tela',
      done: counts.creatives > 0,
      href: '/campanhas',
    },
    {
      label: 'Colocar na programação',
      detail: 'Publicar e enviar aos tablets',
      done: counts.programmedCampaigns > 0 && counts.activeCampaigns > 0,
      href: '/campanhas',
    },
    {
      label: 'Confirmar reprodução',
      detail: 'Ver se o tablet recebeu e começou a tocar',
      done: devices.some(
        (device) =>
          device.playerState === 'playing' && (device.mediaReadyCount ?? 0) > 0,
      ),
      href: '/dispositivos',
    },
  ];

  return (
    <div className="page simplified-dashboard">
      <PageHeader
        eyebrow="MAXCAR"
        title="Início"
        description="Publique campanhas e confira os tablets sem precisar entender a parte técnica."
        action={
          <Link className="button button-primary" href="/campanhas/nova">
            ＋ Criar campanha
          </Link>
        }
      />

      <div className="simple-metrics">
        <Link href="/campanhas?status=active">
          <span>Campanhas no ar</span>
          <strong>{counts.activeCampaigns}</strong>
        </Link>
        <Link href="/dispositivos">
          <span>Tablets reproduzindo</span>
          <strong>
            {
              devices.filter((device) => device.playerState === 'playing')
                .length
            }
          </strong>
        </Link>
        <Link href="/dispositivos?connection=offline">
          <span>Precisam de atenção</span>
          <strong>
            {counts.deviceCounts.attention + counts.deviceCounts.offline}
          </strong>
        </Link>
      </div>

      <div className="simple-dashboard-grid">
        <SectionCard
          title="Como colocar uma campanha no ar"
          subtitle="Siga esta ordem. O sistema mostra o que já está concluído."
        >
          <ol className="setup-checklist">
            {setupSteps.map((step, index) => (
              <li key={step.label} className={step.done ? 'done' : ''}>
                <span>{step.done ? '✓' : index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
                <Link href={step.href}>
                  {step.done ? 'Ver' : 'Fazer agora'} →
                </Link>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard
          title="Tablets"
          subtitle="Situação real informada pelos aparelhos."
          action={<Link href="/dispositivos">Ver todos →</Link>}
        >
          {devices.length === 0 ? (
            <div className="empty-state compact-empty">
              <span>▣</span>
              <strong>Nenhum tablet cadastrado</strong>
              <p>Cadastre o primeiro tablet para começar o piloto.</p>
            </div>
          ) : (
            <div className="simple-device-list">
              {devices.slice(0, 5).map((device) => (
                <Link href={`/dispositivos/${device.id}`} key={device.id}>
                  <span className={`device-light ${device.connection}`} />
                  <div>
                    <strong>{device.code}</strong>
                    <small>
                      {device.vehicleCode ?? 'Sem veículo'} ·{' '}
                      {tabletSummary(device)}
                    </small>
                  </div>
                  <div className="device-list-status">
                    <StatusBadge value={CONNECTION_LABEL[device.connection]} />
                    <small>{formatRelativeTime(device.heartbeatAt)}</small>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
