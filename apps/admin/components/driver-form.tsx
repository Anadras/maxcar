import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';

type Driver = Database['public']['Tables']['drivers']['Row'];

export function DriverForm({
  driver,
  action,
}: {
  driver?: Driver;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Nome completo
        <input
          name="fullName"
          defaultValue={driver?.full_name}
          required
          maxLength={160}
        />
      </label>
      <label>
        Documento
        <input
          name="documentNumber"
          defaultValue={driver?.document_number ?? ''}
          maxLength={30}
        />
      </label>
      <label>
        Telefone
        <input name="phone" defaultValue={driver?.phone ?? ''} maxLength={30} />
      </label>
      <label>
        E-mail
        <input name="email" type="email" defaultValue={driver?.email ?? ''} />
      </label>
      <label>
        Status
        <select name="status" defaultValue={driver?.status ?? 'pending'}>
          <option value="pending">Pendente</option>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
          <option value="suspended">Suspenso</option>
        </select>
      </label>
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/motoristas">
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar motorista
        </button>
      </div>
    </form>
  );
}
