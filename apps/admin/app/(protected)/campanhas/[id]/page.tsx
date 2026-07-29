import {
  campaignReadinessIssues,
  isCampaignStructurallyReady,
} from '@maxcar/business-rules';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setCreativeActive, uploadCreative } from './creative-actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CreativeGallery } from '@/components/creative-gallery';
import { CreativeUploadForm } from '@/components/creative-upload-form';
import { FlashMessage } from '@/components/flash-message';
import { ReadinessBanner } from '@/components/readiness-banner';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import {
  ACTIVE_DAY_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  formatCampaignPeriod,
  priorityLabel,
} from '@/lib/campaigns';
import { getCampaign } from '@/lib/data/campaigns';
import { listCampaignCreatives } from '@/lib/data/creatives';
import { listCampaignGeofences } from '@/lib/data/geofences';

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, campaign, creatives, geofences, auth] = await Promise.all([
    searchParams,
    getCampaign(id),
    listCampaignCreatives(id),
    listCampaignGeofences(id),
    getAuthContext(),
  ]);
  if (!campaign || !campaign.campaign_type || !campaign.status) notFound();
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  const readinessInput = {
    campaignType: campaign.campaign_type,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    dailyStartTime: campaign.daily_start_time,
    dailyEndTime: campaign.daily_end_time,
    activeDays: campaign.active_days ?? [],
    activeCreativeCount: creatives.filter((item) => item.active).length,
    activeGeofenceCount: geofences.filter((item) => item.active).length,
  };
  const readiness = campaignReadinessIssues(readinessInput);
  const ready = isCampaignStructurallyReady(readinessInput);

  return (
    <div className="page campaign-detail">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Campanhas', href: '/campanhas' },
          ...(campaign.advertiser_id && campaign.advertiser_name
            ? [
                {
                  label: campaign.advertiser_name,
                  href: `/clientes/${campaign.advertiser_id}`,
                },
              ]
            : []),
          { label: campaign.name ?? 'Campanha' },
        ]}
      />
      <PageHeader
        eyebrow="CAMPANHA"
        title={campaign.name ?? 'Campanha'}
        description={`${campaign.advertiser_name ?? 'Cliente restrito'} · ${formatCampaignPeriod(campaign.starts_at, campaign.ends_at)}`}
        action={
          canWrite ? (
            <Link
              className="button button-primary"
              href={`/campanhas/${id}/editar`}
            >
              Editar campanha
            </Link>
          ) : undefined
        }
      />
      <ReadinessBanner ready={ready} issues={readiness} />
      <SectionCard title="Resumo">
        <dl className="detail-grid campaign-summary">
          <div>
            <dt>Cliente</dt>
            <dd>{campaign.advertiser_name ?? 'Acesso restrito'}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>
              <StatusBadge
                value={CAMPAIGN_TYPE_LABELS[campaign.campaign_type]}
              />
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge value={CAMPAIGN_STATUS_LABELS[campaign.status]} />
            </dd>
          </div>
          <div>
            <dt>Prioridade</dt>
            <dd>
              {priorityLabel(campaign.priority ?? 50)} · {campaign.priority}
            </dd>
          </div>
          <div>
            <dt>Horário</dt>
            <dd>
              {campaign.daily_start_time?.slice(0, 5) ?? 'Todo o dia'} —{' '}
              {campaign.daily_end_time?.slice(0, 5) ?? 'Todo o dia'}
            </dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd>{campaign.cooldown_seconds ?? 0} segundos</dd>
          </div>
          <div>
            <dt>Dias</dt>
            <dd>
              {(campaign.active_days ?? [])
                .map((day) => ACTIVE_DAY_LABELS[day])
                .join(' · ')}
            </dd>
          </div>
          <div>
            <dt>Limite diário</dt>
            <dd>{campaign.max_daily_impressions ?? 'Sem limite nesta fase'}</dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard
        title="Criativos privados"
        subtitle="Previews assinados expiram em 10 minutos."
      >
        <CreativeGallery
          creatives={creatives}
          canWrite={canWrite}
          toggleAction={setCreativeActive.bind(null, id)}
        />
        {canWrite && (
          <CreativeUploadForm action={uploadCreative.bind(null, id)} />
        )}
      </SectionCard>
      {campaign.campaign_type === 'geo' && (
        <SectionCard
          title="Geofences"
          subtitle="O ponto vem do cadastro do estabelecimento."
          action={
            canWrite ? (
              <Link
                className="button button-secondary"
                href={`/geofences/nova?campaign=${id}`}
              >
                ＋ Adicionar geofence
              </Link>
            ) : undefined
          }
        >
          {geofences.length === 0 ? (
            <div className="empty-state compact-empty">
              <span>◎</span>
              <strong>Nenhuma geofence</strong>
              <p>
                Associe um estabelecimento e um raio para concluir a campanha
                GEO.
              </p>
            </div>
          ) : (
            <div className="geofence-card-grid">
              {geofences.map((geo) => (
                <article key={geo.id ?? ''}>
                  <div
                    className="mini-radius"
                    style={
                      {
                        '--radius-scale': `${Math.min(100, (geo.radius_meters ?? 0) / 50)}px`,
                      } as React.CSSProperties
                    }
                  >
                    <i />
                    <span>{geo.radius_meters} m</span>
                  </div>
                  <div>
                    <strong>{geo.establishment_name}</strong>
                    <p>
                      {geo.city}/{geo.state}
                    </p>
                    <Link href={`/geofences/${geo.id}`}>
                      Visualizar e simular →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
