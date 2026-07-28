'use client';

import { useState } from 'react';
import {
  Button,
  PageHeader,
  SectionCard,
  StatusBadge,
  Toast,
} from '@/components/ui';

export default function SettingsPage() {
  const [toast, setToast] = useState<string | null>(null);
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Configurações"
        description="Parâmetros gerais do ambiente piloto MAXCAR."
      />
      <div className="settings-grid">
        <SectionCard
          title="Ambiente"
          subtitle="Informações da implantação atual"
        >
          <div className="settings-list">
            <div>
              <span>Ambiente</span>
              <StatusBadge value="Demonstração" />
            </div>
            <div>
              <span>Cidade piloto</span>
              <strong>Campo Grande, MS</strong>
            </div>
            <div>
              <span>Fuso horário</span>
              <strong>America/Campo_Grande</strong>
            </div>
            <div>
              <span>Versão do painel</span>
              <strong>MAX-001 · 0.1.0</strong>
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Operação do player"
          subtitle="Padrões preparados para o aplicativo Android"
        >
          <div className="settings-list">
            <div>
              <span>Modo offline-first</span>
              <StatusBadge value="Obrigatório" />
            </div>
            <div>
              <span>Streaming de anúncios</span>
              <strong>Desabilitado</strong>
            </div>
            <div>
              <span>Heartbeat esperado</span>
              <strong>A cada 60 segundos</strong>
            </div>
            <div>
              <span>Retenção local de eventos</span>
              <strong>Até sincronização</strong>
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Recursos futuros"
          subtitle="Planejados para os próximos marcos"
        >
          <div className="future-tags">
            <span>Supabase Auth</span>
            <span>PostgreSQL</span>
            <span>PostGIS</span>
            <span>RLS</span>
            <span>Storage</span>
            <span>Android Kotlin</span>
            <span>Telemetria</span>
            <span>Analytics real</span>
          </div>
        </SectionCard>
        <SectionCard
          title="Identidade da rede"
          subtitle="Configurações gerais de apresentação"
        >
          <div className="settings-form">
            <label>
              Nome da operação
              <input defaultValue="MAXCAR Campo Grande" />
            </label>
            <label>
              Contato operacional
              <input defaultValue="operacao@maxcar.local" />
            </label>
            <Button
              onClick={() => setToast('Configurações demonstrativas salvas.')}
            >
              Salvar alterações
            </Button>
          </div>
        </SectionCard>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
