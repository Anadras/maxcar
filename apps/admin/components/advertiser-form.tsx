import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';

type Advertiser = Database['public']['Tables']['advertisers']['Row'];

export function AdvertiserForm({
  advertiser,
  action,
}: {
  advertiser?: Advertiser;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Razão social
        <input
          name="legalName"
          defaultValue={advertiser?.legal_name}
          required
          maxLength={160}
        />
      </label>
      <label>
        Nome fantasia
        <input
          name="tradeName"
          defaultValue={advertiser?.trade_name}
          required
          maxLength={160}
        />
      </label>
      <label>
        CPF/CNPJ
        <input
          name="documentNumber"
          defaultValue={advertiser?.document_number ?? ''}
          maxLength={30}
        />
      </label>
      <label>
        Status
        <select name="status" defaultValue={advertiser?.status ?? 'active'}>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
          <option value="suspended">Suspenso</option>
        </select>
      </label>
      <label>
        Nome do contato
        <input
          name="contactName"
          defaultValue={advertiser?.contact_name ?? ''}
          maxLength={120}
        />
      </label>
      <label>
        E-mail do contato
        <input
          name="contactEmail"
          type="email"
          defaultValue={advertiser?.contact_email ?? ''}
        />
      </label>
      <label>
        Telefone
        <input
          name="contactPhone"
          defaultValue={advertiser?.contact_phone ?? ''}
          maxLength={30}
        />
      </label>
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/clientes">
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar cliente
        </button>
      </div>
    </form>
  );
}
