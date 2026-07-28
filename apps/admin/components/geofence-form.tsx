import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';
import { SubmitButton } from './submit-button';

type Geofence =
  Database['public']['Views']['campaign_geofence_admin_view']['Row'];
type CampaignOption = Pick<
  Database['public']['Views']['campaign_admin_view']['Row'],
  'id' | 'name' | 'advertiser_id' | 'advertiser_name' | 'status'
>;
type Establishment =
  Database['public']['Views']['establishment_admin_view']['Row'];

export function GeofenceForm({
  geofence,
  campaigns,
  establishments,
  preselectedCampaign,
  action,
}: {
  geofence?: Geofence;
  campaigns: CampaignOption[];
  establishments: Establishment[];
  preselectedCampaign?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="record-form geofence-form">
      <label>
        Campanha GEO
        {geofence?.campaign_id && (
          <input name="campaignId" type="hidden" value={geofence.campaign_id} />
        )}
        <select
          name={geofence ? undefined : 'campaignId'}
          defaultValue={geofence?.campaign_id ?? preselectedCampaign ?? ''}
          disabled={Boolean(geofence)}
          required
        >
          <option value="" disabled>
            Selecione
          </option>
          {campaigns.map((campaign) =>
            campaign.id ? (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name} · {campaign.advertiser_name ?? 'Cliente'}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Estabelecimento
        <select
          name="establishmentId"
          defaultValue={geofence?.establishment_id ?? ''}
          required
        >
          <option value="" disabled>
            Selecione
          </option>
          {establishments.map((item) =>
            item.id ? (
              <option key={item.id} value={item.id}>
                {item.name} · {item.advertiser_name ?? 'Cliente'} · {item.city}/
                {item.state}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Raio em metros
        <input
          name="radiusMeters"
          type="number"
          min="50"
          max="100000"
          step="10"
          defaultValue={geofence?.radius_meters ?? 1000}
          required
        />
        <small>UX recomendada: 50 m a 5 km; banco suporta até 100 km.</small>
      </label>
      <label>
        Prioridade override
        <input
          name="priorityOverride"
          type="number"
          min="0"
          max="100"
          defaultValue={geofence?.priority_override ?? ''}
          placeholder="Usar a campanha"
        />
      </label>
      <label>
        Cooldown override em segundos
        <input
          name="cooldownOverrideSeconds"
          type="number"
          min="0"
          max="86400"
          defaultValue={geofence?.cooldown_override_seconds ?? ''}
          placeholder="Usar a campanha"
        />
      </label>
      <label className="checkbox-field">
        <input
          name="active"
          type="checkbox"
          defaultChecked={geofence?.active ?? true}
        />
        Geofence ativa
      </label>
      <div className="map-preview full-field">
        <span>◎</span>
        <div>
          <strong>Localização herdada do estabelecimento</strong>
          <p>
            Este fluxo altera apenas o raio. O ponto é editado no cadastro do
            estabelecimento.
          </p>
        </div>
      </div>
      <div className="form-actions full-field">
        <Link className="button button-ghost" href="/geofences">
          Cancelar
        </Link>
        <SubmitButton>Salvar geofence</SubmitButton>
      </div>
    </form>
  );
}
