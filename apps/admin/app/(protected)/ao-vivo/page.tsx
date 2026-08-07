import { PageHeader } from '@/components/ui';
import { listLiveDevices } from '@/lib/data/live';
import { LiveView } from './live-view';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const devices = await listLiveDevices();

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPERAÇÃO"
        title="Ao vivo"
        description="O que cada tablet está reproduzindo agora, a partir dos eventos que ele já reporta — sem streaming de tela."
      />
      <LiveView devices={devices} />
    </div>
  );
}
