import { EntityPage } from '@/components/entity-page';
import { clients } from '@/lib/mock-data';
export default function Page() {
  return (
    <EntityPage
      eyebrow="RELACIONAMENTO COMERCIAL"
      title="Clientes"
      description="Anunciantes e parceiros ativos na rede MAXCAR."
      buttonLabel="Novo cliente"
      columns={[
        'Cliente',
        'Segmento',
        'Estabelecimentos',
        'Campanhas',
        'Status',
      ]}
      rows={clients}
    />
  );
}
