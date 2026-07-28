'use client';

import { useState } from 'react';
import { dashboardMetrics } from '@/lib/mock-data';
import {
  MetricCard,
  Modal,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';

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

const activity = [
  ['CAR-001', 'Reprodução concluída', 'Institucional Midiamax', 'agora'],
  ['CAR-017', 'Entrada em geofence', 'Pizzaria Central — Centro', '2 min'],
  ['TB-004', 'Dispositivo offline', 'Último sinal há 42 min', '4 min'],
  ['CAR-028', 'Campanha GEO exibida', 'Plano Verão Prime', '7 min'],
];

export default function DashboardPage() {
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
            {[
              ['CAR-001', 'car-one', 'TB-001', 'Institucional Midiamax'],
              ['CAR-017', 'car-two', 'TB-017', 'Conteúdo editorial'],
              ['CAR-028', 'car-three', 'TB-028', 'Oferta Pizzaria Central'],
              ['CAR-034', 'car-four', 'TB-034', 'Campanha geral'],
              ['CAR-041', 'car-five', 'TB-041', 'Notícias da cidade'],
            ].map(([title, position, tablet, campaign]) => (
              <button
                key={title}
                className={`map-car ${position}`}
                onClick={() =>
                  setSelected({
                    kind: 'car',
                    title,
                    status: 'Online',
                    tablet,
                    campaign,
                  })
                }
                aria-label={`Abrir veículo ${title}`}
              >
                ◆<small>{title}</small>
              </button>
            ))}
            <div className="map-label label-centro">CENTRO</div>
            <div className="map-label label-afonso">AV. AFONSO PENA</div>
            <div className="map-controls">
              <button aria-label="Aumentar zoom">+</button>
              <button aria-label="Diminuir zoom">−</button>
            </div>
            <div className="map-footer">
              <i /> 41 veículos online <span>•</span> 7 zonas GEO ativas
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
            {activity.map(([id, action, detail, time], index) => (
              <article key={`${id}-${action}`}>
                <span className={`activity-icon activity-${index}`}>
                  {index === 2 ? '!' : index === 1 ? '◎' : '▶'}
                </span>
                <div>
                  <strong>{action}</strong>
                  <p>
                    <b>{id}</b> · {detail}
                  </p>
                </div>
                <time>{time}</time>
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
              <b>100%</b>
            </div>
            <progress value="100" max="100" />
            <div>
              <span>GPS</span>
              <b>97,6%</b>
            </div>
            <progress value="97.6" max="100" />
            <div>
              <span>Sincronização</span>
              <b>95,1%</b>
            </div>
            <progress value="95.1" max="100" />
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
              <span>Campanha atual</span>
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
