import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listGeofences } from '@/lib/data/geofences';
import { GEO_PRIORITY_LABEL } from '@/lib/geo-playback-labels';

export default async function GeofencesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const [params, geofences, auth] = await Promise.all([
    searchParams,
    listGeofences(),
    getAuthContext(),
  ]);
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="INTELIGÊNCIA DE PROXIMIDADE"
        title="Geofences"
        description="Zonas reais associadas às campanhas GEO e aos pontos PostGIS."
        action={
          canWrite ? (
            <Link className="button button-primary" href="/geofences/nova">
              ＋ Nova geofence
            </Link>
          ) : undefined
        }
      />
      <SectionCard>
        {geofences.length === 0 ? (
          <EmptyState
            title="Nenhuma geofence cadastrada"
            description="Crie uma campanha GEO e associe um estabelecimento."
            action={
              canWrite
                ? { href: '/geofences/nova', label: 'Criar geofence' }
                : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Cliente</th>
                  <th>Estabelecimento</th>
                  <th>Raio</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {geofences.map((geo) => (
                  <tr key={geo.id ?? ''}>
                    <td>
                      <strong>{geo.campaign_name}</strong>
                    </td>
                    <td>{geo.advertiser_name ?? 'Acesso restrito'}</td>
                    <td>
                      {geo.establishment_name} · {geo.city}/{geo.state}
                    </td>
                    <td>{geo.radius_meters?.toLocaleString('pt-BR')} m</td>
                    <td>
                      {geo.priority_override === null
                        ? `Da campanha${geo.campaign_priority != null ? ` (${GEO_PRIORITY_LABEL[geo.campaign_priority] ?? geo.campaign_priority})` : ''}`
                        : (GEO_PRIORITY_LABEL[geo.priority_override] ??
                          geo.priority_override)}
                    </td>
                    <td>
                      <StatusBadge value={geo.active ? 'Ativa' : 'Inativa'} />
                    </td>
                    <td>
                      <Link href={`/geofences/${geo.id}`}>
                        Mapa e simulação
                      </Link>
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
