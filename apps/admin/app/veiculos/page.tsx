import { EntityPage } from '@/components/entity-page';
import { vehicles } from '@/lib/mock-data';
export default function Page() {
  return (
    <EntityPage
      eyebrow="GESTÃO DE FROTA"
      title="Veículos"
      description="Visibilidade operacional dos carros conectados à rede."
      buttonLabel="Novo veículo"
      columns={['Veículo', 'Motorista', 'Tablet', 'Último sinal', 'Status']}
      rows={vehicles}
      filterOptions={['Todos', 'Online', 'Offline', 'Manutenção']}
    />
  );
}
