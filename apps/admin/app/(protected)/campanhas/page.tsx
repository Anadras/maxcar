import type { CampaignStatus, DatabaseCampaignType } from '@maxcar/shared';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { CAMPAIGN_STATUS_LABELS } from '@/lib/campaigns';
import { listAdvertisers } from '@/lib/data/advertisers';
import { getCampaignMetrics, listCampaigns } from '@/lib/data/campaigns';
import { CampaignTabs } from './campaign-tabs';
import { CampaignTable } from './campaign-table';

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    advertiser?: string;
    type?: DatabaseCampaignType;
    status?: CampaignStatus;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const [campaigns, advertisers, metrics, auth] = await Promise.all([
    listCampaigns({
      query: params.q,
      advertiserId: params.advertiser,
      campaignType: params.type,
      status: params.status,
    }),
    listAdvertisers(),
    getCampaignMetrics(),
    getAuthContext(),
  ]);
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));

  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="PUBLICIDADE"
        title="Campanhas"
        description="Crie, publique e acompanhe tudo que aparece nos tablets."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/campanhas/nova">
              ＋ Criar campanha
            </Link>
          ) : undefined
        }
      />
      <CampaignTabs active="campanhas" />
      <div className="mini-stats">
        <article>
          <span>NO AR AGORA</span>
          <strong>{metrics.active}</strong>
          <small>{metrics.geo} por proximidade cadastradas</small>
        </article>
        <article>
          <span>AGENDADAS</span>
          <strong>{metrics.scheduled}</strong>
          <small>Programação futura</small>
        </article>
        <article>
          <span>RESULTADOS DA BUSCA</span>
          <strong>{campaigns.length}</strong>
          <small>Filtros atuais</small>
        </article>
      </div>
      <SectionCard>
        <form className="campaign-filters">
          <label className="search-box">
            <span>⌕</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar campanha…"
            />
          </label>
          <select
            name="advertiser"
            defaultValue={params.advertiser ?? ''}
            aria-label="Filtrar por cliente"
          >
            <option value="">Todos os clientes</option>
            {advertisers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.trade_name}
              </option>
            ))}
          </select>
          <select
            name="type"
            defaultValue={params.type ?? ''}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos os tipos</option>
            <option value="regular">Programação normal</option>
            <option value="geo">Por proximidade</option>
          </select>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Filtrar por status"
          >
            <option value="">Todos os status</option>
            {Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="button button-secondary" type="submit">
            Filtrar
          </button>
        </form>
        {campaigns.length === 0 ? (
          <EmptyState
            title="Nenhuma campanha encontrada"
            description="Ajuste os filtros ou crie a primeira campanha real."
            action={
              canWrite
                ? { href: '/campanhas/nova', label: 'Criar campanha' }
                : undefined
            }
          />
        ) : (
          <CampaignTable
            campaigns={campaigns.filter(
              (
                campaign,
              ): campaign is typeof campaign & {
                id: string;
                campaign_type: 'regular' | 'geo';
                status: 'draft' | 'scheduled' | 'active' | 'paused' | 'ended';
              } =>
                Boolean(campaign.id && campaign.campaign_type && campaign.status),
            )}
            canWrite={canWrite}
          />
        )}
      </SectionCard>
    </div>
  );
}
