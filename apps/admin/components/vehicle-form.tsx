import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';

type Vehicle = Database['public']['Tables']['vehicles']['Row'];
type DriverOption = {
  id: string;
  full_name: string;
  vehicle_id: string | null;
};

export function VehicleForm({
  vehicle,
  drivers,
  preselectedDriver,
  action,
}: {
  vehicle?: Vehicle;
  drivers: DriverOption[];
  preselectedDriver?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Código interno
        <input
          name="internalCode"
          defaultValue={vehicle?.internal_code}
          required
          maxLength={40}
          placeholder="CAR-001"
        />
      </label>
      <label>
        Placa
        <input
          name="licensePlate"
          defaultValue={vehicle?.license_plate ?? ''}
          maxLength={8}
          placeholder="ABC1D23"
        />
      </label>
      <label>
        Marca
        <input name="make" defaultValue={vehicle?.make ?? ''} maxLength={80} />
      </label>
      <label>
        Modelo
        <input
          name="model"
          defaultValue={vehicle?.model ?? ''}
          maxLength={80}
        />
      </label>
      <label>
        Ano
        <input
          name="year"
          type="number"
          min={1980}
          max={2100}
          defaultValue={vehicle?.year ?? ''}
        />
      </label>
      <label>
        Motorista
        <select
          name="driverId"
          defaultValue={vehicle?.driver_id ?? preselectedDriver ?? ''}
        >
          <option value="">Sem motorista</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.full_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={vehicle?.status ?? 'unassigned'}>
          <option value="active">Ativo</option>
          <option value="offline">Offline operacional</option>
          <option value="maintenance">Manutenção</option>
          <option value="unassigned">Não alocado</option>
          <option value="retired">Desativado</option>
        </select>
      </label>
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/veiculos">
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar veículo
        </button>
      </div>
    </form>
  );
}
