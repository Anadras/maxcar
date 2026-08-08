import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { CREATIVE_TYPE_LABEL } from '@/lib/creative-labels';
import { listAllCreativesForMediaOverview, type MediaStatusFilter } from '@/lib/data/creatives';
import { formatRelativeTime } from '@/lib/fleet';

const FILTERS: Array<{ value: MediaStatusFilter | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'processing', label: 'Processando' },
  { value: 'ready', label: 'Compatível' },
  { value: 'incompatible', label: 'Incompatível' },
  { value: 'failed', label: 'Erro' },
];

const STATUS_BADGE: Record<string, string> = {
  uploaded: 'Enviado',
  queued: 'Na fila',
  processing: 'Processando',
  probing: 'Analisando',
  transcoding: 'Convertendo',
  validating_output: 'Validando',
  ready: 'Compatível',
  incompatible: 'Incompatível',
  failed: 'Erro',
};

export default async function MediaOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status =
    params.status === 'processing' ||
    params.status === 'ready' ||
    params.status === 'incompatible' ||
    params.status === 'failed'
      ? params.status
      : undefined;
  const [creatives, allCreatives] = await Promise.all([
    listAllCreativesForMediaOverview(status),
    listAllCreativesForMediaOverview(),
  ]);

  const counts = {
    processing: allCreatives.filter((c) =>
      ['uploaded', 'queued', 'processing', 'probing', 'transcoding', 'validating_output'].includes(
        c.processing_status,
      ),
    ).length,
    ready: allCreatives.filter((c) => c.processing_status === 'ready').length,
    incompatible: allCreatives.filter((c) => c.processing_status === 'incompatible').length,
    failed: allCreatives.filter((c) => c.processing_status === 'failed').length,
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="PIPELINE DE MÍDIA"
        title="Mídia"
        description="Toda a mídia enviada, em qualquer campanha, e o estado real de validação de cada arquivo."
      />
      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-top">
            <span>PROCESSANDO</span>
          </div>
          <strong>{counts.processing}</strong>
          <small>Ainda no pipeline</small>
        </article>
        <article className="metric-card metric-green">
          <div className="metric-top">
            <span>COMPATÍVEL</span>
          </div>
          <strong>{counts.ready}</strong>
          <small>Validado, pronto para tocar</small>
        </article>
        <article className="metric-card metric-red">
          <div className="metric-top">
            <span>INCOMPATÍVEL</span>
          </div>
          <strong>{counts.incompatible}</strong>
          <small>Nunca chega ao tablet</small>
        </article>
        <article className="metric-card metric-red">
          <div className="metric-top">
            <span>ERRO</span>
          </div>
          <strong>{counts.failed}</strong>
          <small>Falha no processamento</small>
        </article>
      </div>

      <SectionCard>
        <div className="filter-pills" style={{ margin: 16 }}>
          {FILTERS.map((item) => (
            <Link
              key={item.value}
              href={item.value === 'all' ? '/midia' : `/midia?status=${item.value}`}
              className={(status ?? 'all') === item.value ? 'active' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
        {creatives.length === 0 ? (
          <EmptyState
            title="Nenhuma mídia encontrada"
            description="Nenhum criativo corresponde a este filtro."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Criativo</th>
                  <th>Campanha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Enviado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {creatives.map((creative) => (
                  <tr key={creative.id}>
                    <td>
                      <strong>{creative.name}</strong>
                    </td>
                    <td>{creative.campaigns?.name ?? '—'}</td>
                    <td>{creative.campaigns?.advertisers?.trade_name ?? '—'}</td>
                    <td>
                      {CREATIVE_TYPE_LABEL[creative.creative_type] ??
                        creative.creative_type}
                    </td>
                    <td title={creative.processing_error ?? undefined}>
                      <StatusBadge value={STATUS_BADGE[creative.processing_status] ?? creative.processing_status} />
                    </td>
                    <td>{formatRelativeTime(creative.created_at)}</td>
                    <td>
                      <Link href={`/campanhas/${creative.campaign_id}`}>Ver campanha</Link>
                    </td>
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
