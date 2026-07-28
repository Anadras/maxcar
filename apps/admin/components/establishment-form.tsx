import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';

type Establishment =
  Database['public']['Views']['establishment_admin_view']['Row'];
type Advertiser = Database['public']['Tables']['advertisers']['Row'];

export function EstablishmentForm({
  establishment,
  advertisers,
  action,
}: {
  establishment?: Establishment;
  advertisers: Advertiser[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form">
      <label>
        Cliente
        <select
          name="advertiserId"
          defaultValue={establishment?.advertiser_id ?? ''}
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
      <label>
        Latitude
        <input
          name="latitude"
          type="number"
          step="any"
          min="-90"
          max="90"
          defaultValue={establishment?.latitude ?? ''}
          required
        />
      </label>
      <label>
        Longitude
        <input
          name="longitude"
          type="number"
          step="any"
          min="-180"
          max="180"
          defaultValue={establishment?.longitude ?? ''}
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
      <div
        className="map-preview full-field"
        aria-label="Prévia conceitual do mapa"
      >
        <span>◎</span>
        <div>
          <strong>Ponto geográfico WGS84</strong>
          <p>As coordenadas serão persistidas como geography(Point, 4326).</p>
        </div>
      </div>
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
