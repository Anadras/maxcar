import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { CAMPAIGN_TYPE_LABELS } from '@/lib/campaigns';
import { getCampaign } from '@/lib/data/campaigns';
import { getReportData, resolveReportRange } from '@/lib/data/reports';
import { formatDateTime } from '@/lib/fleet';

const PERIOD_LABEL: Record<string, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  custom: 'Período personalizado',
};

function formatMediaTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min`;
  return `${totalSeconds}s`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    campaign?: string;
  }>;
}) {
  const params = await searchParams;
  const range = resolveReportRange(params.period, params.from, params.to);
  const [{ kpis, campaignRows }, filteredCampaign] = await Promise.all([
    getReportData(range, params.campaign),
    params.campaign ? getCampaign(params.campaign) : Promise.resolve(null),
  ]);

  const periodLink = (period: string) =>
    `/relatorios?period=${period}${params.campaign ? `&campaign=${params.campaign}` : ''}`;

  return (
    <div className="page">
      <PageHeader
        eyebrow="ANALYTICS E PERFORMANCE"
        title="Relatórios"
        description={
          filteredCampaign
            ? `Reproduções de "${filteredCampaign.name}", a partir dos eventos que os tablets já confirmaram.`
            : 'Reproduções e desempenho por campanha, a partir dos eventos que os tablets já confirmaram.'
        }
      />
      {params.campaign && (
        <p className="back-link-row">
          <Link href="/relatorios" className="section-link">
            ← Ver todas as campanhas
          </Link>
        </p>
      )}
      <SectionCard className="report-toolbar">
        <div className="filter-pills">
          {(['today', '7d', '30d'] as const).map((period) => (
            <a
              key={period}
              href={periodLink(period)}
              className={range.period === period ? 'active' : undefined}
            >
              {PERIOD_LABEL[period]}
            </a>
          ))}
          <form className="report-custom-range" action="/relatorios">
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={params.from} />
            <span>até</span>
            <input type="date" name="to" defaultValue={params.to} />
            <button type="submit" className="button button-secondary button-small">
              Aplicar
            </button>
          </form>
        </div>
      </SectionCard>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-top">
            <span>REPRODUÇÕES</span>
          </div>
          <strong>{kpis.reproductions.toLocaleString('pt-BR')}</strong>
          <small>{PERIOD_LABEL[range.period]}</small>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span>DISPOSITIVOS ÚNICOS</span>
          </div>
          <strong>{kpis.uniqueDevices}</strong>
          <small>Tablets que reportaram eventos</small>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span>CAMPANHAS EXIBIDAS</span>
          </div>
          <strong>{kpis.campaignsShown}</strong>
          <small>Com pelo menos 1 reprodução</small>
        </article>
        <article className="metric-card metric-cyan">
          <div className="metric-top">
            <span>TEMPO TOTAL DE MÍDIA</span>
          </div>
          <strong>{formatMediaTime(kpis.totalMediaSeconds)}</strong>
          <small>Soma de duração reproduzida</small>
        </article>
        <article className="metric-card metric-cyan">
          <div className="metric-top">
            <span>ATIVAÇÕES GEO</span>
          </div>
          <strong>{kpis.geoActivations}</strong>
          <small>Reproduções por proximidade</small>
        </article>
      </div>

      <SectionCard title="Desempenho por campanha" subtitle={PERIOD_LABEL[range.period]}>
        {campaignRows.length === 0 ? (
          <EmptyState
            title="Nenhuma reprodução no período"
            description="Ajuste o período ou aguarde os tablets sincronizarem novos eventos. Nenhum número aqui é estimado — tudo vem de reproduções que o app já confirmou."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Reproduções</th>
                  <th>Dispositivos</th>
                  <th>Ativações GEO</th>
                  <th>Última reprodução</th>
                </tr>
              </thead>
              <tbody>
                {campaignRows.map((row) => (
                  <tr key={row.campaignId}>
                    <td>
                      <strong>{row.campaignName}</strong>
                    </td>
                    <td>{row.advertiserName ?? '—'}</td>
                    <td>
                      <StatusBadge value={CAMPAIGN_TYPE_LABELS[row.campaignType]} />
                    </td>
                    <td>{row.reproductions.toLocaleString('pt-BR')}</td>
                    <td>{row.uniqueDevices}</td>
                    <td>{row.geoActivations}</td>
                    <td>{formatDateTime(row.lastReproductionAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
