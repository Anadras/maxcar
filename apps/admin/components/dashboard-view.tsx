'use client';

import Link from 'next/link';
import { MetricCard, PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';
import type { RecentActivityItem } from '@/lib/data/dashboard';

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

interface PlayingNowDevice extends DashboardDevice {
  currentCampaignId: string | null;
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
    playing: number;
    fallback: number;
    needsAttention: number;
  };
}

function tabletSummary(device: DashboardDevice) {
  if (device.connection === 'offline') return 'Sem contato com o painel';
  if (device.playerState === 'no_ready_media') return 'Fallback local';
  if (device.lastError) return 'Precisa de atenção';
  if ((device.mediaReadyCount ?? 0) === 0) return 'Aguardando conteúdo';
  if (device.playerState === 'playing_confirmed') return 'Reproduzindo normalmente';
  return 'Conteúdo pronto';
}

export function DashboardView({
  counts,
  devices,
  playingNow,
  recentActivity,
}: {
  counts: DashboardCounts;
  devices: DashboardDevice[];
  playingNow: PlayingNowDevice[];
  recentActivity: RecentActivityItem[];
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
      done: counts.deviceCounts.playing > 0,
      href: '/dispositivos',
    },
  ];
  const pendingSteps = setupSteps.filter((step) => !step.done).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="MAXCAR"
        title="Início"
        description="Resumo operacional da frota e das campanhas em exibição."
        action={
          <Link className="button button-primary" href="/campanhas/nova">
            ＋ Criar campanha
          </Link>
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="CAMPANHAS ATIVAS"
          value={String(counts.activeCampaigns)}
          detail="No ar agora"
          href="/campanhas?status=active"
        />
        <MetricCard
          label="DISPOSITIVOS ONLINE"
          value={`${counts.deviceCounts.online + counts.deviceCounts.attention}/${counts.deviceCounts.total}`}
          detail="Heartbeat recente"
          tone="green"
          href="/dispositivos"
        />
        <MetricCard
          label="REPRODUZINDO AGORA"
          value={String(counts.deviceCounts.playing)}
          detail="Mídia comercial confirmada"
          tone="cyan"
          href="/ao-vivo?filter=playing"
        />
        <MetricCard
          label="PRECISAM DE ATENÇÃO"
          value={String(counts.deviceCounts.needsAttention)}
          detail={`${counts.deviceCounts.fallback} em fallback`}
          tone={counts.deviceCounts.needsAttention > 0 ? 'red' : 'blue'}
          href="/dispositivos?attention=1"
        />
      </div>

      <details className="onboarding-banner" open={pendingSteps > 0}>
        <summary>
          Como colocar uma campanha no ar
          <small>
            {pendingSteps === 0
              ? 'Concluído'
              : `${pendingSteps} etapa(s) pendente(s)`}
          </small>
        </summary>
        <div className="onboarding-banner-body">
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
        </div>
      </details>

      <div className="simple-dashboard-grid">
        <SectionCard
          title="Reproduzindo agora"
          subtitle="Até 3 dispositivos em reprodução confirmada"
          action={<Link href="/ao-vivo">Ver Ao vivo →</Link>}
        >
          {playingNow.length === 0 ? (
            <div className="empty-state compact-empty">
              <span aria-hidden="true">▶</span>
              <strong>Nenhum dispositivo reproduzindo</strong>
              <p>Assim que um tablet confirmar playback, ele aparece aqui.</p>
            </div>
          ) : (
            <div className="simple-device-list">
              {playingNow.map((device) => (
                <Link href={`/dispositivos/${device.id}`} key={device.id}>
                  <span className="device-light online" />
                  <div>
                    <strong>{device.code}</strong>
                    <small>{device.vehicleCode ?? 'Sem veículo'}</small>
                  </div>
                  <div className="device-list-status">
                    <StatusBadge value="Reproduzindo" />
                    <small>{formatRelativeTime(device.heartbeatAt)}</small>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Atividade recente" subtitle="Últimas ações e eventos GEO">
          {recentActivity.length === 0 ? (
            <div className="empty-state compact-empty">
              <span aria-hidden="true">☰</span>
              <strong>Nenhuma atividade recente</strong>
              <p>Publicações, ativações GEO e mudanças administrativas aparecerão aqui.</p>
            </div>
          ) : (
            <ul className="activity-list">
              {recentActivity.map((item) => (
                <li key={item.id} style={{ listStyle: 'none' }}>
                  <article>
                    <span className={`activity-icon ${item.kind === 'geo' ? 'activity-1' : ''}`}>
                      {item.kind === 'geo' ? '◎' : '☰'}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      {item.detail && (
                        <p>
                          <b>{item.detail}</b>
                        </p>
                      )}
                    </div>
                    <time>{formatRelativeTime(item.occurredAt)}</time>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

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
  );
}
