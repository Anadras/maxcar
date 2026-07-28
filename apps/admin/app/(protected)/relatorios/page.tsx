'use client';

import { useState } from 'react';
import { reports } from '@/lib/mock-data';
import {
  Button,
  DataTable,
  MetricCard,
  PageHeader,
  SectionCard,
  Toast,
} from '@/components/ui';

export default function ReportsPage() {
  const [toast, setToast] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHeader
        eyebrow="ANALYTICS E PERFORMANCE"
        title="Relatórios"
        description="Resultados consolidados da operação e das campanhas."
        action={
          <Button
            onClick={() =>
              setToast('Relatório demonstrativo preparado para exportação.')
            }
          >
            ↓ Exportar relatório
          </Button>
        }
      />
      <div className="report-metrics">
        <MetricCard
          label="Reproduções"
          value="328.490"
          detail="+12,4% no período"
          tone="blue"
        />
        <MetricCard
          label="Impressões válidas"
          value="322.174"
          detail="98,1% completas"
          tone="green"
        />
        <MetricCard
          label="Reproduções GEO"
          value="24.891"
          detail="7,6% do inventário"
          tone="cyan"
        />
        <MetricCard
          label="Carros ativos"
          value="41"
          detail="85,4% da frota"
          tone="green"
        />
      </div>
      <div className="report-chart-grid">
        <SectionCard
          title="Reproduções nos últimos 7 dias"
          subtitle="Grade normal e campanhas GEO"
        >
          <div className="bar-chart">
            {[62, 75, 68, 88, 81, 94, 79].map((height, index) => (
              <div key={index}>
                <i style={{ height: `${height}%` }} />
                <b style={{ height: `${Math.max(18, height * 0.22)}%` }} />
                <span>
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][index]}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="Distribuição do inventário"
          subtitle="Por tipo de conteúdo"
        >
          <div className="donut-wrap">
            <div className="donut">
              <span>
                328k<small>total</small>
              </span>
            </div>
            <div className="donut-legend">
              <p>
                <i className="legend-blue" /> Grade comercial <b>54%</b>
              </p>
              <p>
                <i className="legend-cyan" /> Campanhas GEO <b>8%</b>
              </p>
              <p>
                <i className="legend-dark" /> Conteúdo Midiamax <b>38%</b>
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
      <SectionCard
        title="Performance por campanha"
        subtitle="Dados demonstrativos de julho de 2026"
      >
        <DataTable
          columns={[
            'Campanha',
            'Tipo',
            'Reproduções',
            'Completas',
            'Veículos',
            'Período',
          ]}
          rows={reports}
        />
      </SectionCard>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
