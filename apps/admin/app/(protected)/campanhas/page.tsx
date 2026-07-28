import type {
  CampaignStatus,
  DatabaseCampaignType,
} from '@maxcar/shared/database-types';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  formatCampaignPeriod,
  priorityLabel,
} from '@/lib/campaigns';
import { listAdvertisers } from '@/lib/data/advertisers';
import { getCampaignMetrics, listCampaigns } from '@/lib/data/campaigns';

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
        eyebrow="CONTEÚDO E PUBLICIDADE"
        title="Campanhas"
        description="Programação REGULAR e ativações GEO conectadas ao Supabase."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/campanhas/nova">
              ＋ Nova campanha
            </Link>
          ) : undefined
        }
      />
      <div className="mini-stats">
        <article>
          <span>ATIVAS AGORA</span>
          <strong>{metrics.active}</strong>
          <small>{metrics.geo} campanhas GEO cadastradas</small>
        </article>
        <article>
          <span>AGENDADAS</span>
          <strong>{metrics.scheduled}</strong>
          <small>Programação futura</small>
        </article>
        <article>
          <span>TOTAL EXIBIDO</span>
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
            <option value="regular">REGULAR</option>
            <option value="geo">GEO</option>
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Período</th>
                  <th>Prioridade</th>
                  <th>Criativos</th>
                  <th>Geofences</th>
                  <th>Reproduções</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) =>
                  campaign.id && campaign.campaign_type && campaign.status ? (
                    <tr key={campaign.id}>
                      <td>
                        <strong>{campaign.name}</strong>
                        <small>{campaign.id.slice(0, 8)}</small>
                      </td>
                      <td>{campaign.advertiser_name ?? 'Acesso restrito'}</td>
                      <td>
                        <StatusBadge
                          value={CAMPAIGN_TYPE_LABELS[campaign.campaign_type]}
                        />
                      </td>
                      <td>
                        <StatusBadge
                          value={CAMPAIGN_STATUS_LABELS[campaign.status]}
                        />
                      </td>
                      <td>
                        {formatCampaignPeriod(
                          campaign.starts_at,
                          campaign.ends_at,
                        )}
                      </td>
                      <td>
                        {priorityLabel(campaign.priority ?? 50)} ·{' '}
                        {campaign.priority}
                      </td>
                      <td>{campaign.creative_count ?? 0}</td>
                      <td>{campaign.geofence_count ?? 0}</td>
                      <td>
                        {(campaign.impression_count ?? 0).toLocaleString(
                          'pt-BR',
                        )}
                      </td>
                      <td>
                        <Link href={`/campanhas/${campaign.id}`}>Abrir</Link>
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
