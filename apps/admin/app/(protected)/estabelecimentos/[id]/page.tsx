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
import { listGeofencesForEstablishment } from '@/lib/data/geofences';

export default async function EstablishmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, item, geofences, auth] = await Promise.all([
    searchParams,
    getEstablishment(id),
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
                href={`/geofences/nova?establishment=${id}`}
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
        title="Campanhas GEO e geofences"
        subtitle={`${geofences.length} zona(s) de ativação neste estabelecimento`}
        action={
          canWrite && geofences.length > 0 ? (
            <Link
              className="button button-ghost"
              href={`/geofences/nova?establishment=${id}`}
            >
              ＋ Nova geofence
            </Link>
          ) : undefined
        }
      >
        {geofences.length === 0 ? (
          <EmptyState
            title="Nenhuma geofence ainda"
            description="Crie uma campanha GEO para este cliente e associe uma geofence a este estabelecimento para ativar por proximidade."
            action={
              canWrite
                ? {
                    href: `/geofences/nova?establishment=${id}`,
                    label: 'Criar geofence',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="link-list">
            {geofences.map((geo) => (
              <li key={geo.id}>
                <Link href={`/geofences/${geo.id}`}>
                  <strong>{geo.campaign_name}</strong>
                  <span>{geo.radius_meters} m de raio</span>
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
