import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';

// Only what this form actually reads — decoupled from the full row shape
// so callers never need to select sensitive columns (e.g.
// maintenance_pin_hash/salt, MAX-010) just to satisfy this type.
type Device = Pick<
  Database['public']['Tables']['devices']['Row'],
  'device_code' | 'vehicle_id' | 'status' | 'app_version'
>;
type VehicleOption = {
  id: string;
  internal_code: string;
  license_plate: string | null;
  device_id: string | null;
};

export function DeviceForm({
  device,
  vehicles,
  preselectedVehicle,
  action,
}: {
  device?: Device;
  vehicles: VehicleOption[];
  preselectedVehicle?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Código operacional
        <input
          name="deviceCode"
          defaultValue={device?.device_code}
          required
          maxLength={40}
          placeholder="TB-001"
        />
      </label>
      <label>
        Veículo
        <select
          name="vehicleId"
          defaultValue={device?.vehicle_id ?? preselectedVehicle ?? ''}
        >
          <option value="">Sem veículo</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.internal_code}
              {vehicle.license_plate ? ` · ${vehicle.license_plate}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status operacional
        <select name="status" defaultValue={device?.status ?? 'provisioning'}>
          <option value="provisioning">Provisionamento</option>
          <option value="online">Ativo</option>
          <option value="offline">Offline manual</option>
          <option value="maintenance">Manutenção</option>
          <option value="retired">Desativado</option>
        </select>
      </label>
      <label>
        Versão do app
        <input
          name="appVersion"
          defaultValue={device?.app_version ?? ''}
          maxLength={40}
          placeholder="1.0.0"
        />
      </label>
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/dispositivos">
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar dispositivo
        </button>
      </div>
    </form>
  );
}
