import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getEstablishment } from '@/lib/data/establishments';

export default async function EstablishmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const [query, item, auth] = await Promise.all([
    searchParams,
    getEstablishment(id),
    getAuthContext(),
  ]);
  if (!item) notFound();
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <PageHeader
        eyebrow="ESTABELECIMENTO"
        title={item.name ?? 'Estabelecimento'}
        description={`${item.city}/${item.state}`}
        action={
          canWrite ? (
            <Link
              className="button button-primary"
              href={`/estabelecimentos/${id}/editar`}
            >
              Editar
            </Link>
          ) : undefined
        }
      />
      <SectionCard title="Dados da unidade">
        <dl className="detail-grid">
          <div>
            <dt>Cliente</dt>
            <dd>{item.advertiser_name ?? 'Acesso restrito'}</dd>
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
        <div className="map-preview detail-map">
          <span>◎</span>
          <div>
            <strong>Localização geoespacial</strong>
            <p>
              {item.latitude}, {item.longitude} · WGS84
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
