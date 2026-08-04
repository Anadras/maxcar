import {
  campaignReadinessIssues,
  isCampaignStructurallyReady,
} from '@maxcar/business-rules';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setCreativeActive, uploadCreative } from './creative-actions';
import {
  addCampaignToDefaultPlaylist,
  publishCampaignAndSync,
  removeCampaignFromDefaultPlaylist,
} from './playlist-actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { ConfirmSubmitButton } from '@/components/confirm-submit-button';
import { CreativeGallery } from '@/components/creative-gallery';
import { CreativeUploadForm } from '@/components/creative-upload-form';
import { FlashMessage } from '@/components/flash-message';
import { ReadinessBanner } from '@/components/readiness-banner';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet, canWriteCommercialData } from '@/lib/auth/access';
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
import { isCampaignInDefaultPlaylist } from '@/lib/data/playlists';

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
  const canManageGrid = Boolean(auth && canManageFleet(auth.profile.role));
  const canPublish = Boolean(
    auth && ['super_admin', 'admin'].includes(auth.profile.role),
  );
  const inDefaultPlaylist =
    campaign.campaign_type === 'regular' && canManageGrid
      ? await isCampaignInDefaultPlaylist(id)
      : false;
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
      <section className={`launch-panel ${ready ? 'is-ready' : ''}`}>
        <div className="launch-panel-copy">
          <span className="launch-kicker">PUBLICAÇÃO</span>
          <h2>
            {campaign.status === 'active' &&
            (campaign.campaign_type === 'geo' || inDefaultPlaylist)
              ? 'Campanha no ar'
              : ready
                ? 'Tudo pronto para publicar'
                : 'Complete os passos abaixo'}
          </h2>
          <p>
            {campaign.status === 'active' &&
            (campaign.campaign_type === 'geo' || inDefaultPlaylist)
              ? 'Os tablets recebem as atualizações automaticamente.'
              : ready
                ? 'Um único botão ativa a campanha, inclui na programação quando necessário e sincroniza os tablets.'
                : 'O sistema só libera a publicação quando a campanha estiver completa.'}
          </p>
        </div>
        <ol className="launch-steps">
          <li className="done">
            <span>✓</span> Campanha criada
          </li>
          <li className={creatives.some((item) => item.active) ? 'done' : ''}>
            <span>{creatives.some((item) => item.active) ? '✓' : '2'}</span>
            Arquivo enviado
          </li>
          {campaign.campaign_type === 'geo' && (
            <li className={geofences.some((item) => item.active) ? 'done' : ''}>
              <span>{geofences.some((item) => item.active) ? '✓' : '3'}</span>
              Local e raio definidos
            </li>
          )}
          <li
            className={
              campaign.status === 'active' &&
              (campaign.campaign_type === 'geo' || inDefaultPlaylist)
                ? 'done'
                : ''
            }
          >
            <span>
              {campaign.status === 'active' &&
              (campaign.campaign_type === 'geo' || inDefaultPlaylist)
                ? '✓'
                : campaign.campaign_type === 'geo'
                  ? '4'
                  : '3'}
            </span>
            Publicar e sincronizar
          </li>
        </ol>
        {canPublish &&
          ready &&
          !(
            campaign.status === 'active' &&
            (campaign.campaign_type === 'geo' || inDefaultPlaylist)
          ) && (
            <form action={publishCampaignAndSync.bind(null, id)}>
              <button
                className="button button-primary launch-button"
                type="submit"
              >
                Colocar no ar e sincronizar tablets
              </button>
            </form>
          )}
      </section>
      {!ready && <ReadinessBanner ready={ready} issues={readiness} />}
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
      <div id="arquivos-da-campanha">
        <SectionCard
          title="Imagem ou vídeo"
          subtitle="Envie o material que será mostrado no tablet."
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
      </div>
      {campaign.campaign_type === 'regular' && canManageGrid && (
        <SectionCard
          title="Programação dos tablets"
          subtitle="Campanhas normais precisam fazer parte da programação. O botão de publicação faz isso automaticamente."
        >
          <p>
            Status atual:{' '}
            <StatusBadge
              value={inDefaultPlaylist ? 'Na grade do piloto' : 'Fora da grade'}
            />
          </p>
          <form
            action={
              inDefaultPlaylist
                ? removeCampaignFromDefaultPlaylist.bind(null, id)
                : addCampaignToDefaultPlaylist.bind(null, id)
            }
          >
            {inDefaultPlaylist ? (
              <ConfirmSubmitButton
                className="button button-secondary"
                confirmMessage={`Remover "${campaign.name}" da grade padrão do piloto? Tablets que dependem dela deixarão de reproduzi-la no próximo sync.`}
                pendingLabel="Removendo…"
              >
                Retirar da programação
              </ConfirmSubmitButton>
            ) : (
              <button className="button button-primary" type="submit">
                Incluir na programação
              </button>
            )}
          </form>
        </SectionCard>
      )}
      {campaign.campaign_type === 'geo' && (
        <SectionCard
          title="Local de ativação"
          subtitle="Escolha o estabelecimento e a distância em que o anúncio deve entrar na fila."
          action={
            canWrite ? (
              <Link
                className="button button-secondary"
                href={`/geofences/nova?campaign=${id}`}
              >
                ＋ Definir local e raio
              </Link>
            ) : undefined
          }
        >
          {geofences.length === 0 ? (
            <div className="empty-state compact-empty">
              <span>◎</span>
              <strong>Local ainda não definido</strong>
              <p>
                Escolha uma unidade do cliente e o raio para concluir a
                campanha.
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
