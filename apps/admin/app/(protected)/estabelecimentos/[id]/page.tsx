import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteEstablishmentPermanently } from '../actions';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { LocationMap } from '@/components/location-map-loader';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { PilotDeleteAction } from '@/components/pilot-delete-action';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getEstablishment } from '@/lib/data/establishments';
import {
  listGeofencePlacesForEstablishment,
  listGeofencesForEstablishment,
} from '@/lib/data/geofences';

export default async function EstablishmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, item, geofencePlaces, campaignLinks, auth] = await Promise.all([
    searchParams,
    getEstablishment(id),
    listGeofencePlacesForEstablishment(id),
    listGeofencesForEstablishment(id),
    getAuthContext(),
  ]);
  if (!item) notFound();
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));

  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          ...(item.advertiser_id
            ? [
                {
                  label: item.advertiser_name ?? 'Cliente',
                  href: `/clientes/${item.advertiser_id}`,
                },
              ]
            : [{ label: 'Clientes', href: '/clientes' }]),
          { label: item.name ?? 'Estabelecimento' },
        ]}
      />
      <PageHeader
        eyebrow="ESTABELECIMENTO · HUB GEO"
        title={item.name ?? 'Estabelecimento'}
        description={`${item.city}/${item.state}`}
        action={
          canWrite ? (
            <div className="header-actions">
              <Link
                className="button button-secondary"
                href={`/campanhas/nova?advertiser=${item.advertiser_id}&type=geo`}
              >
                ＋ Nova campanha GEO
              </Link>
              <Link
                className="button button-secondary"
                href={`/estabelecimentos/${id}/geofences/nova`}
              >
                ＋ Criar geofence
              </Link>
              <Link
                className="button button-primary"
                href={`/estabelecimentos/${id}/editar`}
              >
                Editar
              </Link>
            </div>
          ) : undefined
        }
      />
      <SectionCard title="Dados da unidade">
        <dl className="detail-grid">
          <div>
            <dt>Cliente</dt>
            <dd>
              {item.advertiser_id ? (
                <Link href={`/clientes/${item.advertiser_id}`}>
                  {item.advertiser_name ?? 'Ver cliente'}
                </Link>
              ) : (
                (item.advertiser_name ?? 'Acesso restrito')
              )}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge value={item.active ? 'Ativo' : 'Inativo'} />
            </dd>
          </div>
          <div>
            <dt>Endereço</dt>
            <dd>
              {[item.address_line, item.number, item.neighborhood]
                .filter(Boolean)
                .join(', ')}
            </dd>
          </div>
          <div>
            <dt>CEP</dt>
            <dd>{item.postal_code ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Latitude</dt>
            <dd>{item.latitude}</dd>
          </div>
          <div>
            <dt>Longitude</dt>
            <dd>{item.longitude}</dd>
          </div>
        </dl>
        {item.latitude != null && item.longitude != null && (
          <LocationMap
            latitude={item.latitude}
            longitude={item.longitude}
            label={item.name ?? 'Estabelecimento'}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Geofences"
        subtitle={`${geofencePlaces.length} local(is) de ativação cadastrados neste estabelecimento`}
        action={
          canWrite && geofencePlaces.length > 0 ? (
            <Link
              className="button button-ghost"
              href={`/estabelecimentos/${id}/geofences/nova`}
            >
              ＋ Nova geofence
            </Link>
          ) : undefined
        }
      >
        {geofencePlaces.length === 0 ? (
          <EmptyState
            title="Nenhuma geofence ainda"
            description="Crie uma geofence (ponto + raio) neste estabelecimento e depois vincule-a a uma ou mais campanhas GEO."
            action={
              canWrite
                ? {
                    href: `/estabelecimentos/${id}/geofences/nova`,
                    label: 'Criar geofence',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="link-list">
            {geofencePlaces.map((geo) => (
              <li key={geo.id}>
                <Link href={`/estabelecimentos/${id}/geofences/${geo.id}/editar`}>
                  <strong>{geo.name}</strong>
                  <span>
                    {geo.radius_meters} m de raio ·{' '}
                    {geo.campaign_link_count ?? 0} campanha(s) vinculada(s)
                  </span>
                  <StatusBadge value={geo.active ? 'Ativa' : 'Inativa'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Campanhas GEO vinculadas"
        subtitle="Vínculos entre campanhas GEO e as geofences deste estabelecimento."
      >
        {campaignLinks.length === 0 ? (
          <EmptyState
            title="Nenhuma campanha vinculada ainda"
            description="Vincule uma geofence acima a uma campanha GEO para que o anúncio comece a ativar por proximidade."
          />
        ) : (
          <ul className="link-list">
            {campaignLinks.map((geo) => (
              <li key={geo.id}>
                <Link href={`/geofences/${geo.id}`}>
                  <strong>{geo.campaign_name}</strong>
                  <span>
                    {geo.geofence_name} · {geo.radius_meters} m de raio
                  </span>
                  <StatusBadge value={geo.active ? 'Ativa' : 'Inativa'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {auth?.profile.role === 'super_admin' && item.advertiser_id && (
        <SectionCard
          title="Excluir unidade"
          subtitle="Disponível enquanto o MAXCAR estiver em fase piloto."
        >
          <PilotDeleteAction
            entityLabel="estabelecimento"
            entityName={item.name ?? 'Estabelecimento'}
            deleteAction={deleteEstablishmentPermanently.bind(
              null,
              id,
              item.advertiser_id,
            )}
          />
        </SectionCard>
      )}
    </div>
  );
}
