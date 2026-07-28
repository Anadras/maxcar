import { EntityPage } from '@/components/entity-page';
import { establishments } from '@/lib/mock-data';
export default function Page() {
  return (
    <EntityPage
      eyebrow="PONTOS DE ATIVAÇÃO"
      title="Estabelecimentos"
      description="Unidades físicas associadas a campanhas geolocalizadas."
      buttonLabel="Novo estabelecimento"
      columns={[
        'Nome',
        'Cliente',
        'Endereço',
        'Cidade',
        'Campanhas GEO',
        'Status',
      ]}
      rows={establishments}
    />
  );
}
