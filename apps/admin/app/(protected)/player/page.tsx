import { PageHeader } from '@/components/ui';
import { PlayerSimulator } from '@/components/player-simulator';

export default function PlayerPage() {
  return (
    <div className="page player-page">
      <PageHeader
        eyebrow="TABLET / PLAYER"
        title="Experiência no veículo"
        description="Demonstração do motor de reprodução offline-first e da fila prioritária GEO."
      />
      <PlayerSimulator />
    </div>
  );
}
