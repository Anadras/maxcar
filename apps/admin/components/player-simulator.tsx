'use client';

import { enqueueGeoAfterCurrent } from '@maxcar/business-rules';
import type { QueueItem } from '@maxcar/shared';
import { useEffect, useRef, useState } from 'react';
import { geoCampaign, initialQueue } from '@/lib/mock-data';
import { Button, StatusBadge } from './ui';

type PlayerPhase = 'regular' | 'queued' | 'playing-geo' | 'resuming';

export function PlayerSimulator({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState<PlayerPhase>('regular');
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  function simulate() {
    if (phase !== 'regular') return;
    setPhase('queued');
    setQueue(enqueueGeoAfterCurrent(initialQueue, geoCampaign));
    timers.current.push(window.setTimeout(() => setPhase('playing-geo'), 2400));
    timers.current.push(window.setTimeout(() => setPhase('resuming'), 6100));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('regular');
        setQueue(initialQueue);
      }, 7800),
    );
  }

  const isGeo = phase === 'playing-geo';
  const currentTitle = isGeo
    ? 'Oferta Pizzaria Central'
    : phase === 'resuming'
      ? 'Conteúdo editorial'
      : 'Institucional Midiamax';
  const currentIndex = isGeo ? 1 : phase === 'resuming' ? 2 : 0;

  return (
    <div className={`player-simulator ${compact ? 'player-compact' : ''}`}>
      <div className="tablet-stage">
        <div className="tablet">
          <div className="tablet-camera" />
          <div className={`tablet-screen ${isGeo ? 'screen-geo' : ''}`}>
            <div className="screen-top">
              <div className="screen-brand">
                M <span>MAXCAR</span>
              </div>
              <div>
                <i /> PLAYER ONLINE
              </div>
            </div>
            {isGeo ? (
              <div className="geo-creative">
                <span className="proximity-label">
                  ATIVAÇÃO POR PROXIMIDADE
                </span>
                <div className="pizza-icon">P</div>
                <p>PIZZARIA CENTRAL</p>
                <h3>20% OFF</h3>
                <strong>Você está a poucos minutos.</strong>
                <small>Apresente esta tela no balcão · Válido hoje</small>
              </div>
            ) : (
              <div className="regular-creative">
                <span>INFORMAÇÃO QUE MOVE</span>
                <div className="creative-logo">M</div>
                <h3>MIDIAMAX</h3>
                <p>Conectado com Campo Grande.</p>
                <div className="news-strip">
                  AGORA &nbsp; Trânsito tranquilo na região central
                </div>
              </div>
            )}
            <div className="screen-progress">
              <i className={phase === 'queued' ? 'finishing' : ''} />
            </div>
          </div>
          <div className="tablet-home" />
        </div>
        <div className="tablet-status">
          <span>
            <i />{' '}
            {phase === 'regular'
              ? 'GRADE NORMAL'
              : isGeo
                ? 'CAMPANHA GEO'
                : phase === 'queued'
                  ? 'FINALIZANDO MÍDIA ATUAL'
                  : 'RETORNANDO À GRADE'}
          </span>
          <strong>{currentTitle}</strong>
        </div>
      </div>
      <div className="queue-panel">
        <header>
          <div>
            <p>PLAYER ENGINE</p>
            <h2>Fila de reprodução</h2>
          </div>
          <StatusBadge
            value={phase === 'regular' ? 'Operacional' : 'GEO elegível'}
          />
        </header>
        <div className={`geo-message message-${phase}`}>
          <span>
            {phase === 'regular'
              ? '◎'
              : phase === 'queued'
                ? '✓'
                : isGeo
                  ? '▶'
                  : '↻'}
          </span>
          <div>
            <strong>
              {phase === 'regular'
                ? 'Monitorando geofences'
                : phase === 'queued'
                  ? 'Campanha GEO adicionada à fila'
                  : isGeo
                    ? 'Campanha GEO em reprodução'
                    : 'Retornando à grade normal'}
            </strong>
            <p>
              {phase === 'regular'
                ? 'GPS ativo · 7 zonas próximas'
                : phase === 'queued'
                  ? 'A mídia atual não foi interrompida.'
                  : isGeo
                    ? 'Evento de impressão sendo registrado.'
                    : 'A programação regular continua.'}
            </p>
          </div>
        </div>
        <div className="queue-list">
          {queue.map((item, index) => {
            const active = index === currentIndex;
            const next = phase === 'queued' && item.kind === 'geo';
            return (
              <article
                key={item.id}
                className={`${active ? 'queue-active' : ''} ${item.kind === 'geo' ? 'queue-geo' : ''}`}
              >
                <div className="queue-position">
                  {active ? '▶' : String(index + 1).padStart(2, '0')}
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.kind === 'geo'
                      ? 'Campanha geolocalizada'
                      : index === 0
                        ? 'Institucional'
                        : 'Grade regular'}
                  </span>
                </div>
                {next ? (
                  <b>PRÓXIMO</b>
                ) : item.kind === 'geo' ? (
                  <StatusBadge value="GEO" />
                ) : (
                  <time>{item.durationSeconds}s</time>
                )}
              </article>
            );
          })}
        </div>
        <div className="player-callout">
          <span>i</span>
          <p>
            <strong>Regra MAXCAR:</strong> campanhas GEO entram na próxima
            posição elegível. O conteúdo em reprodução sempre termina
            normalmente.
          </p>
        </div>
        <Button
          onClick={simulate}
          variant={phase === 'regular' ? 'primary' : 'secondary'}
        >
          {phase === 'regular'
            ? '◎ SIMULAR ENTRADA EM GEOFENCE'
            : 'SIMULAÇÃO EM ANDAMENTO...'}
        </Button>
      </div>
    </div>
  );
}
