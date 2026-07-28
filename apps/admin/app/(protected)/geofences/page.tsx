'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  PageHeader,
  SectionCard,
  StatusBadge,
  Toast,
} from '@/components/ui';

export default function GeofencesPage() {
  const [radius, setRadius] = useState(1500);
  const [simulated, setSimulated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHeader
        eyebrow="INTELIGÊNCIA DE PROXIMIDADE"
        title="Geofences"
        description="Configure e simule áreas de ativação para campanhas locais."
        action={
          <Button
            onClick={() =>
              setToast('Fluxo demonstrativo de nova geofence iniciado.')
            }
          >
            ＋ Nova geofence
          </Button>
        }
      />
      <div className="geofence-layout">
        <SectionCard
          title="Configuração da zona"
          subtitle="Pizzaria Central — Unidade Centro"
          className="geo-controls"
        >
          <div className="control-form">
            <label>
              Cliente
              <select defaultValue="Pizzaria Central">
                <option>Pizzaria Central</option>
                <option>Academia Prime</option>
              </select>
            </label>
            <label>
              Estabelecimento
              <select>
                <option>Unidade Centro</option>
                <option>Unidade Afonso Pena</option>
              </select>
            </label>
            <label className="range-label">
              <span>
                Raio de ativação{' '}
                <strong>{radius.toLocaleString('pt-BR')} m</strong>
              </span>
              <input
                type="range"
                min="300"
                max="2500"
                step="100"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
              <div>
                <small>300 m</small>
                <small>2.500 m</small>
              </div>
            </label>
            <div className="dual-fields">
              <label>
                Cooldown
                <select>
                  <option>15 minutos</option>
                  <option>30 minutos</option>
                </select>
              </label>
              <label>
                Prioridade
                <select>
                  <option>Alta</option>
                  <option>Média</option>
                </select>
              </label>
            </div>
            <label>
              Horário ativo
              <div className="time-fields">
                <input type="time" defaultValue="11:00" />
                <span>até</span>
                <input type="time" defaultValue="23:00" />
              </div>
            </label>
            <div className="eligibility-card">
              <span>✓</span>
              <div>
                <strong>Regras válidas</strong>
                <p>
                  Campanha pronta para entrar na fila quando o veículo cruzar o
                  raio.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Simulador de entrada"
          subtitle="Visualização conceitual — Campo Grande, MS"
          className="geo-map-card"
          action={<StatusBadge value="GPS ativo" />}
        >
          <div className="geo-simulation-map">
            <div className="sim-road sim-road-one" />
            <div className="sim-road sim-road-two" />
            <div
              className="radius-circle"
              style={{
                width: `${150 + radius / 11}px`,
                height: `${150 + radius / 11}px`,
              }}
            >
              <span>{radius.toLocaleString('pt-BR')} m</span>
            </div>
            <div className="store-pin">
              <span>P</span>
              <div>
                <strong>Pizzaria Central</strong>
                <small>Unidade Centro</small>
              </div>
            </div>
            <div className={`simulation-car ${simulated ? 'car-entered' : ''}`}>
              ◆<span>CAR-017</span>
            </div>
            {simulated && (
              <div className="eligibility-pop">
                <i /> CAMPANHA ELEGÍVEL
              </div>
            )}
            <div className="map-scale">200 m ━━━━━</div>
          </div>
          <div className="simulation-footer">
            <div>
              <span
                className={`pulse-dot ${simulated ? 'pulse-active' : ''}`}
              />
              <p>
                <strong>
                  {simulated
                    ? 'Veículo dentro da zona'
                    : 'Veículo fora da zona'}
                </strong>
                <small>
                  {simulated
                    ? 'Oferta Pizzaria Central entrou na fila prioritária.'
                    : 'Pronto para executar a simulação.'}
                </small>
              </p>
            </div>
            {!simulated ? (
              <Button onClick={() => setSimulated(true)}>
                ▶ SIMULAR ENTRADA DO VEÍCULO
              </Button>
            ) : (
              <div className="sim-actions">
                <button onClick={() => setSimulated(false)}>Reiniciar</button>
                <Link href="/player">Ver fila no Tablet / Player →</Link>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
      <SectionCard className="geo-rule-card">
        <div className="rule-flow">
          <div>
            <span>01</span>
            <strong>GRADE NORMAL</strong>
            <small>Mídia atual em reprodução</small>
          </div>
          <b>→</b>
          <div>
            <span>02</span>
            <strong>ENTRADA NO RAIO</strong>
            <small>Campanha torna-se elegível</small>
          </div>
          <b>→</b>
          <div>
            <span>03</span>
            <strong>FILA PRIORITÁRIA</strong>
            <small>Sem interromper a mídia</small>
          </div>
          <b>→</b>
          <div>
            <span>04</span>
            <strong>EXIBIÇÃO GEO</strong>
            <small>Depois retorna à grade</small>
          </div>
        </div>
      </SectionCard>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
