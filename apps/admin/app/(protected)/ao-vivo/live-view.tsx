'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LiveStatusBadge } from '@/components/ui';
import { priorityLabel } from '@/lib/campaigns';
import { formatRelativeTime } from '@/lib/fleet';
import { PLAYBACK_MODE_LABEL } from '@/lib/geo-playback-labels';
import { KIOSK_LEVEL_LABEL } from '@/lib/kiosk-labels';
import type { LiveDevice, LiveStatus } from '@/lib/data/live';

const FILTERS: Array<{ value: LiveStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'playing', label: 'Reproduzindo' },
  { value: 'geo', label: 'GEO' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'attention', label: 'Atenção' },
  { value: 'offline', label: 'Offline' },
];

export function LiveView({ devices }: { devices: LiveDevice[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<LiveStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LiveDevice | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(interval);
  }, [router]);

  const counts = useMemo(() => {
    const base: Record<LiveStatus, number> = {
      playing: 0,
      geo: 0,
      fallback: 0,
      attention: 0,
      offline: 0,
    };
    for (const device of devices) base[device.liveStatus] += 1;
    return base;
  }, [devices]);

  const online = devices.length - counts.offline;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return devices.filter((device) => {
      if (filter !== 'all' && device.liveStatus !== filter) return false;
      if (!term) return true;
      return [device.deviceCode, device.licensePlate, device.driverName, device.vehicleCode]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
  }, [devices, filter, query]);

  return (
    <div>
      <div className="metric-grid">
        <article className="metric-card metric-green">
          <div className="metric-top">
            <span>ONLINE</span>
          </div>
          <strong>{online}</strong>
          <small>de {devices.length} dispositivos</small>
        </article>
        <article className="metric-card metric-green">
          <div className="metric-top">
            <span>REPRODUZINDO</span>
          </div>
          <strong>{counts.playing}</strong>
          <small>Mídia comercial confirmada</small>
        </article>
        <article className="metric-card metric-cyan">
          <div className="metric-top">
            <span>GEO ATIVO</span>
          </div>
          <strong>{counts.geo}</strong>
          <small>Por proximidade agora</small>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span>FALLBACK</span>
          </div>
          <strong>{counts.fallback}</strong>
          <small>Conteúdo local de segurança</small>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span>ATENÇÃO</span>
          </div>
          <strong>{counts.attention}</strong>
          <small>Estado degradado</small>
        </article>
        <article className="metric-card metric-red">
          <div className="metric-top">
            <span>OFFLINE</span>
          </div>
          <strong>{counts.offline}</strong>
          <small>Sem heartbeat recente</small>
        </article>
      </div>

      <div className="live-toolbar">
        <div className="live-filter-pills">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? 'active' : undefined}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="live-search">
          <span aria-hidden="true">⌕</span>
          <input
            placeholder="Buscar dispositivo, placa ou motorista…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span aria-hidden="true">⌕</span>
          <strong>Nenhum dispositivo encontrado</strong>
          <p>Nenhum dispositivo corresponde aos filtros atuais.</p>
          {(filter !== 'all' || query) && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="live-grid">
          {filtered.map((device) => (
            <article
              key={device.id}
              className={`live-card live-card-${device.liveStatus === 'geo' ? 'geo' : device.liveStatus === 'fallback' ? 'fallback' : device.liveStatus === 'offline' ? 'offline' : ''}`}
              onClick={() => setSelected(device)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelected(device);
              }}
            >
              <div className="live-card-header">
                <div>
                  <strong>{device.deviceCode}</strong>
                  <small>
                    {[device.vehicleCode, device.driverName].filter(Boolean).join(' • ') || 'Sem veículo vinculado'}
                  </small>
                </div>
                <LiveStatusBadge status={device.liveStatus} />
              </div>

              <div className="live-preview">
                {device.currentCreativeType === 'image' ? (
                  <div className="live-preview-placeholder">
                    <span aria-hidden="true">▧</span>
                    <small>Imagem estática</small>
                  </div>
                ) : (
                  <div className="live-preview-placeholder">
                    <span aria-hidden="true">▶</span>
                    <small>Preview não disponível</small>
                  </div>
                )}
              </div>

              {device.liveStatus === 'geo' && device.geo && (
                <div className="live-geo-panel">
                  <strong>GEO ATIVO</strong>
                  <dl>
                    <div>
                      <dt>Campanha</dt>
                      <dd>{device.geo.campaignName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Geofence</dt>
                      <dd>{device.geo.geofenceName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Prioridade</dt>
                      <dd>
                        {device.geo.priority != null
                          ? priorityLabel(device.geo.priority)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Latência</dt>
                      <dd>
                        {device.geo.latencySeconds !== null
                          ? `${device.geo.latencySeconds.toFixed(1)}s`
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {device.liveStatus === 'fallback' && (
                <div className="live-fallback-panel">
                  <strong>FALLBACK LOCAL</strong>
                  <p style={{ margin: '4px 0 0' }}>
                    Nenhuma mídia comercial elegível. Recuperação automática em
                    andamento.
                  </p>
                  <dl>
                    <div>
                      <dt>Em quarentena</dt>
                      <dd>{device.quarantinedMediaCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Último manifesto</dt>
                      <dd>{device.manifestVersion ?? '—'}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {(device.liveStatus === 'playing' || device.liveStatus === 'attention') && (
                <div className="live-card-body">
                  <div className="live-media-name">
                    <strong>{device.currentCampaignName ?? 'Sem mídia atual'}</strong>
                    <small>{device.currentCreativeName ?? '—'}</small>
                  </div>
                  {device.nextCampaignName && (
                    <div className="live-next">Próxima: {device.nextCampaignName}</div>
                  )}
                </div>
              )}

              <div className="live-meta-row">
                <span>
                  Heartbeat: <b>{formatRelativeTime(device.heartbeatAt)}</b>
                </span>
                <span>
                  GPS: <b>{device.gpsAvailable ? 'OK' : device.gpsAvailable === false ? 'Indisponível' : '—'}</b>
                </span>
                <span>
                  Rede: <b>{device.networkConnected ? 'OK' : device.networkConnected === false ? 'Sem rede' : '—'}</b>
                </span>
                <span>
                  App: <b>{device.appVersion ?? '—'}</b>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {selected && (
        <>
          <button
            className="drawer-backdrop"
            aria-label="Fechar detalhe"
            onClick={() => setSelected(null)}
          />
          <div className="drawer" role="dialog" aria-modal="true">
            <div className="drawer-header">
              <h2>{selected.deviceCode}</h2>
              <button
                className="icon-button"
                onClick={() => setSelected(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="drawer-section">
              <h3>Identidade</h3>
              <dl className="drawer-kv">
                <div>
                  <dt>Veículo</dt>
                  <dd>{selected.vehicleCode ?? '—'}</dd>
                </div>
                <div>
                  <dt>Motorista</dt>
                  <dd>{selected.driverName ?? '—'}</dd>
                </div>
                <div>
                  <dt>App</dt>
                  <dd>{selected.appVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>Kiosk</dt>
                  <dd>
                    {selected.kioskLevel
                      ? (KIOSK_LEVEL_LABEL[selected.kioskLevel] ??
                        selected.kioskLevel)
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="drawer-section">
              <h3>Conectividade</h3>
              <dl className="drawer-kv">
                <div>
                  <dt>Heartbeat</dt>
                  <dd>{formatRelativeTime(selected.heartbeatAt)}</dd>
                </div>
                <div>
                  <dt>Bateria</dt>
                  <dd>{selected.batteryLevel !== null ? `${selected.batteryLevel}%` : '—'}</dd>
                </div>
                <div>
                  <dt>Rede</dt>
                  <dd>{selected.networkConnected ? 'Conectado' : 'Sem rede'}</dd>
                </div>
                <div>
                  <dt>GPS</dt>
                  <dd>{selected.gpsAvailable ? 'Disponível' : 'Indisponível'}</dd>
                </div>
              </dl>
            </div>
            <div className="drawer-section">
              <h3>Player</h3>
              <dl className="drawer-kv">
                <div>
                  <dt>Estado</dt>
                  <dd>
                    <LiveStatusBadge status={selected.liveStatus} />
                  </dd>
                </div>
                <div>
                  <dt>Mídia atual</dt>
                  <dd>{selected.currentCreativeName ?? '—'}</dd>
                </div>
                <div>
                  <dt>Campanha</dt>
                  <dd>{selected.currentCampaignName ?? '—'}</dd>
                </div>
                <div>
                  <dt>Próxima</dt>
                  <dd>{selected.nextCampaignName ?? '—'}</dd>
                </div>
              </dl>
            </div>
            <div className="drawer-section">
              <h3>Recuperação</h3>
              <dl className="drawer-kv">
                <div>
                  <dt>Em quarentena</dt>
                  <dd>{selected.quarantinedMediaCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Último erro</dt>
                  <dd>{selected.lastError ?? 'Nenhum'}</dd>
                </div>
              </dl>
            </div>
            {selected.geo && (
              <div className="drawer-section">
                <h3>GEO</h3>
                <dl className="drawer-kv">
                  <div>
                    <dt>Geofence</dt>
                    <dd>{selected.geo.geofenceName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Prioridade</dt>
                    <dd>
                      {selected.geo.priority != null
                        ? priorityLabel(selected.geo.priority)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Modo</dt>
                    <dd>
                      {selected.geo.playbackMode
                        ? (PLAYBACK_MODE_LABEL[selected.geo.playbackMode] ??
                          selected.geo.playbackMode)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Latência</dt>
                    <dd>
                      {selected.geo.latencySeconds !== null
                        ? `${selected.geo.latencySeconds.toFixed(1)}s`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
            <div className="drawer-section">
              <h3>Sincronização</h3>
              <dl className="drawer-kv">
                <div>
                  <dt>Último manifesto</dt>
                  <dd>{selected.manifestVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>Sincronizado</dt>
                  <dd>{formatRelativeTime(selected.manifestSyncedAt)}</dd>
                </div>
                <div>
                  <dt>Eventos pendentes</dt>
                  <dd>{selected.pendingEventCount ?? 0}</dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
