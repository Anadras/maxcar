import Link from 'next/link';
import { notFound } from 'next/navigation';
import { simulateGeofence } from '../actions';
import { FlashMessage } from '@/components/flash-message';
import { GeofenceSimulator } from '@/components/geofence-simulator';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
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
  const radiusSize = Math.min(330, 130 + (geofence.radius_meters ?? 0) / 15);
  return (
    <div className="page">
      <FlashMessage success={query.success} error={query.error} />
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
          subtitle="Mapa conceitual baseado nas coordenadas PostGIS."
          className="geo-map-card"
        >
          <div className="real-geo-map">
            <div className="map-grid-lines" />
            <div
              className="real-radius"
              style={{ width: radiusSize, height: radiusSize }}
            >
              <span>{geofence.radius_meters?.toLocaleString('pt-BR')} m</span>
            </div>
            <div className="real-store-pin">
              ⌂<strong>{geofence.establishment_name}</strong>
            </div>
            <div className="coordinate-chip">
              {geofence.latitude.toFixed(5)}, {geofence.longitude.toFixed(5)}
            </div>
          </div>
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
              <dt>Prioridade</dt>
              <dd>{geofence.priority_override ?? 'Herdada da campanha'}</dd>
            </div>
            <div>
              <dt>Cooldown</dt>
              <dd>
                {geofence.cooldown_override_seconds ?? 'Herdado da campanha'}
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
