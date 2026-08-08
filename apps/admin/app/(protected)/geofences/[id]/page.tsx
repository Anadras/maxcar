import Link from 'next/link';
import { notFound } from 'next/navigation';
import { simulateGeofence } from '../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceSimulator } from '@/components/geofence-simulator';
import { LocationMap } from '@/components/location-map-loader';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import {
  formatCooldownMinutes,
  PLAYBACK_MODE_LABEL,
} from '@/lib/geo-playback-labels';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { priorityLabel } from '@/lib/campaigns';
import { getGeofence } from '@/lib/data/geofences';

export default async function GeofenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, geofence, auth] = await Promise.all([
    searchParams,
    getGeofence(id),
    getAuthContext(),
  ]);
  if (!geofence || geofence.latitude === null || geofence.longitude === null)
    notFound();
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  return (
    <div className="page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Geofences', href: '/geofences' },
          { label: geofence.establishment_name ?? 'Zona GEO' },
        ]}
      />
      <PageHeader
        eyebrow="GEOFENCE"
        title={geofence.establishment_name ?? 'Zona GEO'}
        description={`${geofence.campaign_name} · ${geofence.advertiser_name ?? 'Cliente restrito'}`}
        action={
          canWrite ? (
            <Link
              className="button button-primary"
              href={`/geofences/${id}/editar`}
            >
              Editar raio
            </Link>
          ) : undefined
        }
      />
      <div className="geofence-detail-layout">
        <SectionCard
          title="Visualização da zona"
          subtitle="Mapa real com o raio configurado, a partir das coordenadas PostGIS."
          className="geo-map-card"
        >
          <LocationMap
            latitude={geofence.latitude}
            longitude={geofence.longitude}
            radiusMeters={geofence.radius_meters ?? undefined}
            label={geofence.establishment_name ?? 'Zona GEO'}
          />
        </SectionCard>
        <SectionCard title="Regras">
          <dl className="detail-grid single-detail">
            <div>
              <dt>Campanha</dt>
              <dd>{geofence.campaign_name}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge value={geofence.active ? 'Ativa' : 'Inativa'} />
              </dd>
            </div>
            <div>
              <dt>Raio</dt>
              <dd>{geofence.radius_meters} metros</dd>
            </div>
            <div>
              <dt>Quando exibir ao entrar na área?</dt>
              <dd>
                {geofence.playback_mode_override
                  ? PLAYBACK_MODE_LABEL[geofence.playback_mode_override]
                  : `Usar a campanha${
                      geofence.campaign_playback_mode
                        ? ` (${PLAYBACK_MODE_LABEL[geofence.campaign_playback_mode]})`
                        : ''
                    }`}
              </dd>
            </div>
            <div>
              <dt>Prioridade do anúncio GEO</dt>
              <dd>
                {geofence.priority_override != null
                  ? priorityLabel(geofence.priority_override)
                  : `Usar a campanha${
                      geofence.campaign_priority != null
                        ? ` (${priorityLabel(geofence.campaign_priority)})`
                        : ''
                    }`}
              </dd>
            </div>
            <div>
              <dt>Tempo para permitir nova exibição</dt>
              <dd>
                {geofence.cooldown_override_seconds != null
                  ? formatCooldownMinutes(geofence.cooldown_override_seconds)
                  : `Usar a campanha${
                      geofence.campaign_cooldown_seconds != null
                        ? ` (${formatCooldownMinutes(geofence.campaign_cooldown_seconds)})`
                        : ''
                    }`}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>
      <SectionCard
        title="Simular posição do veículo"
        subtitle="Distância e elegibilidade calculadas no PostgreSQL/PostGIS."
      >
        <GeofenceSimulator
          action={simulateGeofence.bind(null, id)}
          initialLatitude={geofence.latitude}
          initialLongitude={geofence.longitude}
        />
      </SectionCard>
    </div>
  );
}
