import { EmptyState } from '@/components/empty-state';
import { PageHeader, SectionCard } from '@/components/ui';

export default function ReportsPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="ANALYTICS E PERFORMANCE"
        title="Relatórios"
        description="Resultados consolidados de reprodução e desempenho por campanha."
      />
      <SectionCard
        title="Em breve"
        subtitle="Depende do aplicativo Android (MAX-006 em diante)"
      >
        <EmptyState
          title="Ainda não há reproduções reais para relatar"
          description="Reproduções, impressões e desempenho por campanha aparecerão aqui assim que o aplicativo Android sincronizar eventos reais. Até lá, esta área não mostra números demonstrativos para evitar confusão com dados de operação."
        />
      </SectionCard>
    </div>
  );
}
