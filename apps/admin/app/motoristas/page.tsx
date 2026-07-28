import { EntityPage } from '@/components/entity-page';
import { drivers } from '@/lib/mock-data';
export default function Page() {
  return (
    <EntityPage
      eyebrow="OPERAÇÃO EM CAMPO"
      title="Motoristas"
      description="Acompanhe sessões, disponibilidade e vínculo com a frota."
      buttonLabel="Novo motorista"
      columns={[
        'Nome',
        'Veículo',
        'Status',
        'Horas ativas',
        'Disponibilidade',
        'Último sinal',
      ]}
      rows={drivers}
      filterOptions={['Todos', 'Disponível', 'Offline']}
    />
  );
}
