'use client';

import { useMemo, useState } from 'react';
import { CONNECTION_LABEL } from '@/lib/fleet';

type ConnectionStatus = 'online' | 'attention' | 'offline' | 'inactive';

export interface CampaignDeviceOption {
  id: string;
  deviceCode: string;
  connectionStatus: ConnectionStatus;
  vehicleCode: string | null;
  driverName: string | null;
  assigned: boolean;
}

export function CampaignDevicePicker({
  devices,
  unrestricted,
  action,
}: {
  devices: CampaignDeviceOption[];
  unrestricted: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [scope, setScope] = useState<'all' | 'selected'>(
    unrestricted ? 'all' : 'selected',
  );
  const [search, setSearch] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(devices.map((device) => [device.id, device.assigned])),
  );

  const visibleDevices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return devices.filter((device) => {
      if (onlineOnly && device.connectionStatus !== 'online') return false;
      if (!term) return true;
      return [device.deviceCode, device.vehicleCode, device.driverName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
  }, [devices, search, onlineOnly]);

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <form action={action} className="device-picker">
      <input type="hidden" name="scope" value={scope} />
      <div className="device-picker-scope">
        <label className="radio-option">
          <input
            type="radio"
            name="scopeChoice"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          Todos os dispositivos ativos
        </label>
        <label className="radio-option">
          <input
            type="radio"
            name="scopeChoice"
            checked={scope === 'selected'}
            onChange={() => setScope('selected')}
          />
          Somente os dispositivos selecionados
        </label>
      </div>

      {scope === 'selected' && (
        <>
          <div className="device-picker-toolbar">
            <input
              type="search"
              placeholder="Buscar por tablet, veículo ou motorista…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={onlineOnly}
                onChange={(event) => setOnlineOnly(event.target.checked)}
              />
              Somente online
            </label>
            <button
              type="button"
              className="button button-ghost"
              onClick={() =>
                setChecked((prev) => {
                  const next = { ...prev };
                  for (const device of visibleDevices) next[device.id] = true;
                  return next;
                })
              }
            >
              Selecionar todos visíveis
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() =>
                setChecked((prev) => {
                  const next = { ...prev };
                  for (const device of visibleDevices) next[device.id] = false;
                  return next;
                })
              }
            >
              Limpar seleção visível
            </button>
            <span className="device-picker-count">
              {selectedCount} selecionado(s)
            </span>
          </div>

          {visibleDevices.length === 0 ? (
            <p className="section-empty">Nenhum dispositivo encontrado.</p>
          ) : (
            <ul className="device-picker-list">
              {visibleDevices.map((device) => (
                <li key={device.id}>
                  <label>
                    <input
                      type="checkbox"
                      name="deviceIds"
                      value={device.id}
                      checked={checked[device.id] ?? false}
                      onChange={(event) =>
                        setChecked((prev) => ({
                          ...prev,
                          [device.id]: event.target.checked,
                        }))
                      }
                    />
                    <span className="device-picker-code">
                      {device.deviceCode}
                    </span>
                    <span
                      className={`device-picker-status device-picker-status-${device.connectionStatus}`}
                    >
                      {CONNECTION_LABEL[device.connectionStatus]}
                    </span>
                    <span className="device-picker-meta">
                      {device.vehicleCode ?? 'Sem veículo'}
                      {device.driverName ? ` · ${device.driverName}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="form-actions">
        <button className="button button-primary" type="submit">
          Salvar dispositivos
        </button>
      </div>
    </form>
  );
}
