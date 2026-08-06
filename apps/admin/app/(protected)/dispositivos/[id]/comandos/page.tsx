import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageFleet } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getDevice, listDeviceCommandHistory } from '@/lib/data/devices';
import { formatDateTime } from '@/lib/fleet';
import type { DeviceCommandType } from '@maxcar/shared';

const COMMAND_LABEL: Record<DeviceCommandType, string> = {
  sync_now: 'Sincronizar agora',
  restart_player: 'Reiniciar player',
  clear_obsolete_media: 'Limpar mídia obsoleta',
  enter_maintenance: 'Entrar em manutenção',
  exit_maintenance: 'Sair da manutenção',
  update_config: 'Atualizar configuração',
  enable_kiosk: 'Ativar quiosque',
  disable_kiosk_temporarily: 'Suspender quiosque temporariamente',
  reenter_kiosk: 'Retomar quiosque agora',
};

const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  delivered: 'Entregue',
  completed: 'Concluído',
  failed: 'Falhou',
  expired: 'Expirado',
};

export default async function DeviceCommandHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [device, auth] = await Promise.all([getDevice(id), getAuthContext()]);
  if (!device) notFound();
  if (!auth || !canManageFleet(auth.profile.role)) notFound();
  const commands = await listDeviceCommandHistory(id);

  return (
    <div className="page record-page">
      <Breadcrumbs
        items={[
          { label: 'Frota' },
          { label: 'Dispositivos', href: '/dispositivos' },
          { label: device.device_code, href: `/dispositivos/${id}` },
          { label: 'Histórico de comandos' },
        ]}
      />
      <PageHeader
        eyebrow="DISPOSITIVO"
        title={`Histórico de comandos — ${device.device_code}`}
        description="Últimos 100 comandos remotos enviados a este tablet."
      />
      <SectionCard>
        {commands.length === 0 ? (
          <p className="section-empty">Nenhum comando enviado ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comando</th>
                  <th>Status</th>
                  <th>Enviado em</th>
                  <th>Entregue em</th>
                  <th>Concluído em</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((command) => (
                  <tr key={command.id}>
                    <td>{COMMAND_LABEL[command.command_type]}</td>
                    <td>
                      <StatusBadge
                        value={
                          COMMAND_STATUS_LABEL[command.status] ??
                          command.status
                        }
                      />
                    </td>
                    <td>{formatDateTime(command.created_at)}</td>
                    <td>{formatDateTime(command.delivered_at)}</td>
                    <td>{formatDateTime(command.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
