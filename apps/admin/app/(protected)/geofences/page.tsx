import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { priorityLabel } from '@/lib/campaigns';
import { listGeofences } from '@/lib/data/geofences';
import {
  PLAYBACK_MODE_LABEL,
  formatCooldownMinutes,
} from '@/lib/geo-playback-labels';
import { createClient } from '@/lib/supabase/server';

async function activationsToday(geofenceIds: string[]) {
  if (geofenceIds.length === 0) return new Map<string, number>();
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from('geofence_events')
    .select('campaign_geofence_id')
    .in('campaign_geofence_id', geofenceIds)
    .eq('event_type', 'enter')
    .gte('occurred_at', startOfDay.toISOString());
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.campaign_geofence_id, (counts.get(row.campaign_geofence_id) ?? 0) + 1);
  }
  return counts;
}

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
  const activations = await activationsToday(
    geofences.map((geo) => geo.id).filter((id): id is string => Boolean(id)),
  );
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
                  <th>Modo</th>
                  <th>Prioridade</th>
                  <th>Nova exibição</th>
                  <th>Ativações hoje</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {geofences.map((geo) => {
                  const playbackMode = geo.playback_mode_override ?? geo.campaign_playback_mode;
                  const cooldownSeconds = geo.cooldown_override_seconds ?? geo.campaign_cooldown_seconds;
                  return (
                  <tr key={geo.id ?? ''}>
                    <td>
                      <strong>{geo.campaign_name}</strong>
                    </td>
                    <td>{geo.advertiser_name ?? 'Acesso restrito'}</td>
                    <td>
                      {geo.establishment_name} · {geo.city}/{geo.state}
                    </td>
                    <td>{geo.radius_meters?.toLocaleString('pt-BR')} m</td>
                    <td>{playbackMode ? (PLAYBACK_MODE_LABEL[playbackMode] ?? playbackMode) : '—'}</td>
                    <td>
                      {geo.priority_override === null
                        ? `Da campanha${geo.campaign_priority != null ? ` (${priorityLabel(geo.campaign_priority)})` : ''}`
                        : priorityLabel(geo.priority_override)}
                    </td>
                    <td>{cooldownSeconds != null ? formatCooldownMinutes(cooldownSeconds) : '—'}</td>
                    <td>{activations.get(geo.id ?? '') ?? 0}</td>
                    <td>
                      <StatusBadge value={geo.active ? 'Ativa' : 'Inativa'} />
                    </td>
                    <td>
                      <Link href={`/geofences/${geo.id}`}>
                        Mapa e simulação
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
