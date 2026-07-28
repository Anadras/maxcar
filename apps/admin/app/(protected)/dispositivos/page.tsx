import { EntityPage } from '@/components/entity-page';
import { devices } from '@/lib/mock-data';
export default function Page() {
  return (
    <EntityPage
      eyebrow="SAÚDE DOS TABLETS"
      title="Dispositivos"
      description="Monitoramento técnico dos players instalados nos veículos."
      buttonLabel="Novo dispositivo"
      columns={[
        'Dispositivo',
        'Veículo',
        'Status',
        'Bateria',
        'GPS',
        'Sincronização',
        'App',
        'Heartbeat',
      ]}
      rows={devices}
      filterOptions={['Todos', 'Online', 'Offline', 'Atenção']}
    />
  );
}
