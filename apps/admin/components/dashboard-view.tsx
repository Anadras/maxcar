'use client';

import { useState } from 'react';
import {
  MetricCard,
  Modal,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { CONNECTION_LABEL, formatRelativeTime } from '@/lib/fleet';

type MapSelection =
  | {
      kind: 'car';
      title: string;
      status: string;
      tablet: string;
      campaign: string;
    }
  | {
      kind: 'geo';
      title: string;
      client: string;
      radius: string;
      priority: string;
    }
  | null;

interface DashboardDevice {
  id: string;
  code: string;
  vehicleCode: string | null;
  driverName: string | null;
  heartbeatAt: string | null;
  batteryLevel: number | null;
  networkConnected: boolean | null;
  gpsAvailable: boolean | null;
  connection: 'online' | 'attention' | 'offline' | 'inactive';
}

export interface DashboardMetric {
  label: string;
  value: string;
  detail: string;
  tone: string;
}

export function DashboardView({
  dashboardMetrics,
  devices,
}: {
  dashboardMetrics: DashboardMetric[];
  devices: DashboardDevice[];
}) {
  const [selected, setSelected] = useState<MapSelection>(null);
  return (
    <div className="page">
      <PageHeader
        eyebrow="CENTRAL DE OPERAÇÕES"
        title="Visão geral"
        description="Acompanhe a rede MAXCAR em tempo real."
        action={
          <div className="date-pill">
            ● Hoje, 28 de julho <span>⌄</span>
          </div>
        }
      />
      <div className="metric-grid">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
      <div className="dashboard-grid">
        <SectionCard
          title="Mapa operacional"
          subtitle="Veículos e zonas GEO em Campo Grande"
          className="map-card"
          action={
            <div className="map-legend">
              <span>
                <i className="car-dot" /> Veículos
              </span>
              <span>
                <i className="geo-dot" /> Geofences
              </span>
            </div>
          }
        >
          <div
            className="operation-map"
            aria-label="Mapa operacional conceitual"
          >
            <div className="map-road road-one" />
            <div className="map-road road-two" />
            <div className="map-road road-three" />
            <div className="map-block block-one" />
            <div className="map-block block-two" />
            <div className="map-block block-three" />
            <button
              className="geofence-zone geo-one"
              onClick={() =>
                setSelected({
                  kind: 'geo',
                  title: 'Pizzaria Central — Centro',
                  client: 'Pizzaria Central',
                  radius: '1.500 m',
                  priority: 'Alta',
                })
              }
              aria-label="Abrir geofence Pizzaria Central"
            >
              <span>GEO</span>
            </button>
            <button
              className="geofence-zone geo-two"
              onClick={() =>
                setSelected({
                  kind: 'geo',
                  title: 'Academia Prime — Centro',
                  client: 'Academia Prime',
                  radius: '900 m',
                  priority: 'Média',
                })
              }
              aria-label="Abrir geofence Academia Prime"
            >
              <span>GEO</span>
            </button>
            {devices.slice(0, 5).map((device, index) => (
              <button
                key={device.id}
                className={`map-car ${['car-one', 'car-two', 'car-three', 'car-four', 'car-five'][index]}`}
                onClick={() =>
                  setSelected({
                    kind: 'car',
                    title: device.vehicleCode ?? 'Sem veículo',
                    status: CONNECTION_LABEL[device.connection],
                    tablet: device.code,
                    campaign: device.driverName ?? 'Sem motorista',
                  })
                }
                aria-label={`Abrir veículo ${device.vehicleCode ?? device.code}`}
              >
                ◆<small>{device.vehicleCode ?? device.code}</small>
              </button>
            ))}
            <div className="map-label label-centro">CENTRO</div>
            <div className="map-label label-afonso">AV. AFONSO PENA</div>
            <div className="map-controls">
              <button aria-label="Aumentar zoom">+</button>
              <button aria-label="Diminuir zoom">−</button>
            </div>
            <div className="map-footer">
              <i />{' '}
              {
                devices.filter((device) => device.connection === 'online')
                  .length
              }{' '}
              tablets online <span>•</span> {devices.length} monitorados
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Atividade recente"
          subtitle="Eventos da rede em tempo real"
          className="activity-card"
          action={<button className="text-button">Ver tudo →</button>}
        >
          <div className="activity-list">
            {devices.slice(0, 6).map((device, index) => (
              <article key={device.id}>
                <span className={`activity-icon activity-${index}`}>
                  {device.connection === 'offline' ? '!' : '◎'}
                </span>
                <div>
                  <strong>{CONNECTION_LABEL[device.connection]}</strong>
                  <p>
                    <b>{device.code}</b> · {device.vehicleCode ?? 'Sem veículo'}
                  </p>
                </div>
                <time>{formatRelativeTime(device.heartbeatAt)}</time>
              </article>
            ))}
          </div>
          <div className="network-health">
            <header>
              <strong>Saúde da rede</strong>
              <StatusBadge value="Operacional" />
            </header>
            <div>
              <span>Player</span>
              <b>
                {devices.length
                  ? `${Math.round((devices.filter((device) => device.connection === 'online').length / devices.length) * 100)}%`
                  : '0%'}
              </b>
            </div>
            <progress
              value={
                devices.filter((device) => device.connection === 'online')
                  .length
              }
              max={Math.max(devices.length, 1)}
            />
            <div>
              <span>GPS</span>
              <b>
                {devices.length
                  ? `${Math.round((devices.filter((device) => device.gpsAvailable).length / devices.length) * 100)}%`
                  : '0%'}
              </b>
            </div>
            <progress
              value={devices.filter((device) => device.gpsAvailable).length}
              max={Math.max(devices.length, 1)}
            />
            <div>
              <span>Sincronização</span>
              <b>
                {devices.length
                  ? `${Math.round((devices.filter((device) => device.networkConnected).length / devices.length) * 100)}%`
                  : '0%'}
              </b>
            </div>
            <progress
              value={devices.filter((device) => device.networkConnected).length}
              max={Math.max(devices.length, 1)}
            />
          </div>
        </SectionCard>
      </div>
      <Modal
        title={selected?.title ?? ''}
        open={selected !== null}
        onClose={() => setSelected(null)}
      >
        {selected?.kind === 'car' ? (
          <div className="detail-grid">
            <div>
              <span>Status</span>
              <StatusBadge value={selected.status} />
            </div>
            <div>
              <span>GPS</span>
              <strong>Saudável</strong>
            </div>
            <div>
              <span>Internet</span>
              <strong>Online</strong>
            </div>
            <div>
              <span>Tablet</span>
              <strong>{selected.tablet}</strong>
            </div>
            <div>
              <span>Último heartbeat</span>
              <strong>Agora</strong>
            </div>
            <div>
              <span>Motorista</span>
              <strong>{selected.campaign}</strong>
            </div>
          </div>
        ) : selected?.kind === 'geo' ? (
          <div className="detail-grid">
            <div>
              <span>Cliente</span>
              <strong>{selected.client}</strong>
            </div>
            <div>
              <span>Campanha</span>
              <strong>Oferta por proximidade</strong>
            </div>
            <div>
              <span>Raio</span>
              <strong>{selected.radius}</strong>
            </div>
            <div>
              <span>Prioridade</span>
              <StatusBadge value={selected.priority} />
            </div>
            <div>
              <span>Horário</span>
              <strong>11:00 — 23:00</strong>
            </div>
            <div>
              <span>Status</span>
              <StatusBadge value="Ativa" />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
