import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';
import { CoordinateInput } from './coordinate-input';

type Establishment =
  Database['public']['Views']['establishment_admin_view']['Row'];
type Advertiser = Database['public']['Tables']['advertisers']['Row'];

export function EstablishmentForm({
  establishment,
  advertisers,
  preselectedAdvertiser,
  action,
}: {
  establishment?: Establishment;
  advertisers: Advertiser[];
  preselectedAdvertiser?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Cliente
        <select
          name="advertiserId"
          defaultValue={
            establishment?.advertiser_id ?? preselectedAdvertiser ?? ''
          }
          required
        >
          <option value="" disabled>
            Selecione
          </option>
          {advertisers.map((advertiser) => (
            <option key={advertiser.id} value={advertiser.id}>
              {advertiser.trade_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nome da unidade
        <input name="name" defaultValue={establishment?.name ?? ''} required />
      </label>
      <label className="full-field">
        Logradouro
        <input
          name="addressLine"
          defaultValue={establishment?.address_line ?? ''}
          required
        />
      </label>
      <label>
        Número
        <input name="number" defaultValue={establishment?.number ?? ''} />
      </label>
      <label>
        Complemento
        <input
          name="complement"
          defaultValue={establishment?.complement ?? ''}
        />
      </label>
      <label>
        Bairro
        <input
          name="neighborhood"
          defaultValue={establishment?.neighborhood ?? ''}
        />
      </label>
      <label>
        CEP
        <input
          name="postalCode"
          defaultValue={establishment?.postal_code ?? ''}
        />
      </label>
      <label>
        Cidade
        <input name="city" defaultValue={establishment?.city ?? ''} required />
      </label>
      <label>
        UF
        <input
          name="state"
          defaultValue={establishment?.state ?? 'MS'}
          minLength={2}
          maxLength={2}
          required
        />
      </label>
      <label className="checkbox-field">
        <input
          name="active"
          type="checkbox"
          defaultChecked={establishment?.active ?? true}
        />
        Estabelecimento ativo
      </label>
      <CoordinateInput
        initialLatitude={establishment?.latitude ?? null}
        initialLongitude={establishment?.longitude ?? null}
        label={establishment?.name ?? 'Novo estabelecimento'}
      />
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/estabelecimentos">
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar estabelecimento
        </button>
      </div>
    </form>
  );
}
