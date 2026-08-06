import {
  campaignReadinessIssues,
  isCampaignStructurallyReady,
} from '@maxcar/business-rules';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  cancelCreativeUpload,
  finalizeCreativeUpload,
  prepareCreativeUpload,
  setCreativeActive,
} from './creative-actions';
import {
  addCampaignToDefaultPlaylist,
  publishCampaignAndSync,
  removeCampaignFromDefaultPlaylist,
} from './playlist-actions';
import { setCampaignDevices } from './device-assignment-actions';
import { testGeoCampaignDelivery } from './geo-test-actions';
import { deleteCampaignPermanently } from '../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CampaignDevicePicker } from '@/components/campaign-device-picker';
import { GeoCampaignTestPanel } from '@/components/geo-campaign-test-panel';
import { ConfirmSubmitButton } from '@/components/confirm-submit-button';
import { CreativeGallery } from '@/components/creative-gallery';
import { CreativeUploadForm } from '@/components/creative-upload-form';
import { FlashMessage } from '@/components/flash-message';
import { PilotDeleteAction } from '@/components/pilot-delete-action';
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
import {
  listCampaignDeliveryStatus,
  listCampaignDeviceAssignments,
} from '@/lib/data/campaign-devices';
import { getCampaign } from '@/lib/data/campaigns';
import { listCampaignCreatives } from '@/lib/data/creatives';
import { listCampaignGeofences } from '@/lib/data/geofences';
import { isCampaignInDefaultPlaylist } from '@/lib/data/playlists';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, campaign, auth] = await Promise.all([
    searchParams,
    getCampaign(id),
    getAuthContext(),
  ]);
  if (!campaign || !campaign.campaign_type || !campaign.status) notFound();
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  const canManageGrid = Boolean(auth && canManageFleet(auth.profile.role));
  const canPublish = Boolean(
    auth && ['super_admin', 'admin'].includes(auth.profile.role),
  );
  const canSimulateGeoTest =
    process.env.NODE_ENV !== 'production' &&
    auth?.profile.role === 'super_admin';
  const [
    creativesResult,
    geofencesResult,
    playlistResult,
    deviceAssignmentResult,
    deliveryStatusResult,
  ] = await Promise.allSettled([
    listCampaignCreatives(id),
    campaign.campaign_type === 'geo'
      ? listCampaignGeofences(id)
      : Promise.resolve([]),
    campaign.campaign_type === 'regular' && canManageGrid
      ? isCampaignInDefaultPlaylist(id)
      : Promise.resolve(false),
    canManageGrid
      ? listCampaignDeviceAssignments(id)
      : Promise.resolve({ unrestricted: true, devices: [] }),
    canManageGrid
      ? listCampaignDeliveryStatus(id, {
          updatedAt: campaign.updated_at ?? null,
          campaignType: campaign.campaign_type,
        })
      : Promise.resolve([]),
  ]);
  const creatives =
    creativesResult.status === 'fulfilled' ? creativesResult.value : [];
  const geofences =
    geofencesResult.status === 'fulfilled' ? geofencesResult.value : [];
  const inDefaultPlaylist =
    playlistResult.status === 'fulfilled' ? playlistResult.value : false;
  const deviceAssignment =
    deviceAssignmentResult.status === 'fulfilled'
      ? deviceAssignmentResult.value
      : { unrestricted: true, devices: [] };
  const deliveryStatus =
    deliveryStatusResult.status === 'fulfilled'
      ? deliveryStatusResult.value
      : [];
  const unavailableSections = [
    creativesResult.status === 'rejected' ? 'arquivos' : null,
    geofencesResult.status === 'rejected' ? 'local de ativação' : null,
    playlistResult.status === 'rejected' ? 'programação dos tablets' : null,
  ].filter((section): section is string => Boolean(section));
  if (unavailableSections.length > 0) {
    console.error('Campaign detail loaded with unavailable sections', {
      campaignId: id,
      sections: unavailableSections,
      creativeError:
        creativesResult.status === 'rejected'
          ? errorCode(creativesResult.reason)
          : undefined,
      geofenceError:
        geofencesResult.status === 'rejected'
          ? errorCode(geofencesResult.reason)
          : undefined,
      playlistError:
        playlistResult.status === 'rejected'
          ? errorCode(playlistResult.reason)
          : undefined,
    });
  }
  const readinessInput = {
    campaignType: campaign.campaign_type,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    dailyStartTime: campaign.daily_start_time,
    dailyEndTime: campaign.daily_end_time,
    activeDays: campaign.active_days ?? [],
    activeCreativeCount: creatives.filter((item) => item.active).length,
    activeReadyCreativeCount: creatives.filter(
      (item) =>
        item.active &&
        (item.processing_status === 'ready' ||
          item.processed_storage_path !== null),
    ).length,
    activeGeofenceCount: geofences.filter((item) => item.active).length,
  };
  const readiness = campaignReadinessIssues(readinessInput);
  const ready = isCampaignStructurallyReady(readinessInput);

  return (
    <div className="page campaign-detail">
      <FlashMessage
        success={query.success}
        error={
          query.error ??
          (unavailableSections.length > 0
            ? `A campanha abriu, mas não foi possível carregar: ${unavailableSections.join(', ')}. Você ainda pode enviar um novo arquivo e tentar novamente.`
            : undefined)
        }
      />
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
          <li
            className={
              readinessInput.activeReadyCreativeCount > 0 ? 'done' : ''
            }
          >
            <span>
              {readinessInput.activeReadyCreativeCount > 0 ? '✓' : '2'}
            </span>
            {creatives.some((item) => item.active) &&
            readinessInput.activeReadyCreativeCount === 0
              ? 'Arquivo enviado (processando…)'
              : 'Arquivo enviado'}
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
          {canWrite && campaign.advertiser_id && (
            <CreativeUploadForm
              prepareAction={prepareCreativeUpload.bind(null, id)}
              finalizeAction={finalizeCreativeUpload.bind(null, id)}
              cancelAction={cancelCreativeUpload.bind(null, id)}
            />
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
          {canSimulateGeoTest && geofences.length > 0 && (
            <>
              <h3 className="section-subheading">
                Testar campanha GEO neste dispositivo (simulado)
              </h3>
              <GeoCampaignTestPanel
                devices={deviceAssignment.devices.map((device) => ({
                  id: device.id,
                  deviceCode: device.deviceCode,
                }))}
                action={testGeoCampaignDelivery.bind(null, id)}
              />
            </>
          )}
        </SectionCard>
      )}
      {canManageGrid && (
        <SectionCard
          title="Dispositivos desta campanha"
          subtitle={
            campaign.campaign_type === 'geo'
              ? 'Restrinja quais tablets podem exibir este anúncio GEO, mesmo dentro do raio configurado.'
              : 'Restrinja quais tablets recebem este anúncio, além da programação normal.'
          }
        >
          <CampaignDevicePicker
            devices={deviceAssignment.devices}
            unrestricted={deviceAssignment.unrestricted}
            action={setCampaignDevices.bind(null, id)}
          />
        </SectionCard>
      )}
      {canManageGrid && (
        <SectionCard
          title="Status de entrega por tablet"
          subtitle="O que cada tablet elegível está fazendo com esta campanha agora, em linguagem simples."
        >
          {deliveryStatus.length === 0 ? (
            <p className="section-empty">
              Nenhum tablet ativo elegível para esta campanha ainda.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tablet</th>
                    <th>Veículo</th>
                    <th>Conexão</th>
                    <th>Situação</th>
                    <th>Última sincronização</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryStatus.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/dispositivos/${row.id}`}>
                          {row.deviceCode}
                        </Link>
                      </td>
                      <td>{row.vehicleCode ?? 'Sem vínculo'}</td>
                      <td>
                        <StatusBadge
                          value={CONNECTION_LABEL[row.connectionStatus]}
                        />
                      </td>
                      <td>{row.statusLabel}</td>
                      <td>{formatRelativeTime(row.lastSyncAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
      {auth?.profile.role === 'super_admin' && (
        <SectionCard
          title="Excluir campanha"
          subtitle="Disponível enquanto o MAXCAR estiver em fase piloto."
        >
          <PilotDeleteAction
            entityLabel="campanha"
            entityName={campaign.name ?? 'Campanha'}
            deleteAction={deleteCampaignPermanently.bind(null, id)}
          />
        </SectionCard>
      )}
    </div>
  );
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'unknown';
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unclassified';
}
