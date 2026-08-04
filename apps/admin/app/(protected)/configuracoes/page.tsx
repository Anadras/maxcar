import Link from 'next/link';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';

export default function SettingsPage() {
  const environment = process.env.NEXT_PUBLIC_APP_ENV ?? 'development';
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Configurações"
        description="Informações somente leitura sobre o ambiente atual do MAXCAR."
      />
      <div className="settings-grid">
        <SectionCard
          title="Ambiente"
          subtitle="Implantação atual, sem edição pelo painel"
        >
          <div className="settings-list">
            <div>
              <span>Ambiente</span>
              <StatusBadge value={environment} />
            </div>
            <div>
              <span>Cidade piloto</span>
              <strong>Campo Grande, MS</strong>
            </div>
            <div>
              <span>Fuso horário operacional</span>
              <strong>America/Campo_Grande</strong>
            </div>
            <div>
              <span>Fase atual</span>
              <StatusBadge value="Piloto" />
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Operação do player"
          subtitle="Padrões definidos para o futuro aplicativo Android"
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
          title="Controle e transparência"
          subtitle="Ações sensíveis e registros administrativos"
        >
          <p>
            Enquanto o modo piloto estiver ativo, o superadministrador pode
            excluir cadastros e dados de teste. Toda exclusão exige senha,
            motivo e fica registrada.
          </p>
          <Link
            className="button button-secondary"
            href="/configuracoes/auditoria"
          >
            Ver histórico de exclusões
          </Link>
        </SectionCard>
      </div>
    </div>
  );
}
