'use client';

import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';
import { useState } from 'react';
import { PLAYBACK_MODE_LABEL } from '@/lib/geo-playback-labels';
import { LocationMap } from './location-map-loader';
import { SubmitButton } from './submit-button';

type Geofence =
  Database['public']['Views']['campaign_geofence_admin_view']['Row'];
type CampaignOption = Pick<
  Database['public']['Views']['campaign_admin_view']['Row'],
  | 'id'
  | 'name'
  | 'advertiser_id'
  | 'advertiser_name'
  | 'status'
  | 'priority'
  | 'cooldown_seconds'
  | 'playback_mode'
  | 'max_wait_seconds'
>;

type Establishment =
  Database['public']['Views']['establishment_admin_view']['Row'];

export function GeofenceForm({
  geofence,
  campaigns,
  establishments,
  preselectedCampaign,
  preselectedEstablishment,
  action,
}: {
  geofence?: Geofence;
  campaigns: CampaignOption[];
  establishments: Establishment[];
  preselectedCampaign?: string;
  preselectedEstablishment?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  // The geofence's point is never entered here — it's inherited from the
  // establishment (see EstablishmentForm/CoordinateInput for where a
  // point actually gets typed or dropped on a map). This form only picks
  // *which* establishment and *what radius*, so the map preview just
  // reacts to those two choices instead of taking its own lat/lng input.
  const [campaignId, setCampaignId] = useState(
    geofence?.campaign_id ?? preselectedCampaign ?? '',
  );
  const selectedCampaign = campaigns.find((item) => item.id === campaignId);
  const [establishmentId, setEstablishmentId] = useState(
    geofence?.establishment_id ?? preselectedEstablishment ?? '',
  );
  const [radiusMeters, setRadiusMeters] = useState(
    geofence?.radius_meters ?? 1000,
  );
  const selectedEstablishment = establishments.find(
    (item) => item.id === establishmentId,
  );

  // MAX-011: "Usar a campanha" is represented as an empty string in the
  // <select>s below (never as a hidden third state) and mapped back to
  // null — exactly how priority/cooldown overrides already worked before
  // this feature, just now with a friendlier label than a blank number
  // field.
  const [playbackModeOverride, setPlaybackModeOverride] = useState(
    geofence?.playback_mode_override ?? '',
  );
  const [maxWaitSecondsOverride, setMaxWaitSecondsOverride] = useState(
    geofence?.max_wait_seconds_override ?? 5,
  );

  const PRIORITY_PRESETS = [5, 10, 20];
  const initialPriorityPreset =
    geofence?.priority_override == null
      ? ''
      : PRIORITY_PRESETS.includes(geofence.priority_override)
        ? String(geofence.priority_override)
        : 'custom';
  const [priorityPreset, setPriorityPreset] = useState(initialPriorityPreset);
  // Read-only in this UI (only shown so a pre-existing, non-preset value
  // is never silently discarded) — never reassigned, so a plain constant
  // rather than a second piece of state.
  const priorityCustomValue = geofence?.priority_override ?? 50;

  const COOLDOWN_PRESETS = [60, 300, 600, 900, 1800];
  const initialCooldownPreset =
    geofence?.cooldown_override_seconds == null
      ? ''
      : COOLDOWN_PRESETS.includes(geofence.cooldown_override_seconds)
        ? String(geofence.cooldown_override_seconds)
        : 'custom';
  const [cooldownPreset, setCooldownPreset] = useState(initialCooldownPreset);
  const [cooldownCustomValue, setCooldownCustomValue] = useState(
    geofence?.cooldown_override_seconds ?? 900,
  );

  return (
    <form action={action} className="record-form geofence-form">
      <label>
        Campanha GEO
        {geofence?.campaign_id && (
          <input name="campaignId" type="hidden" value={geofence.campaign_id} />
        )}
        <select
          name={geofence ? undefined : 'campaignId'}
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
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
          value={establishmentId}
          onChange={(event) => setEstablishmentId(event.target.value)}
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
          value={radiusMeters}
          onChange={(event) => setRadiusMeters(Number(event.target.value) || 0)}
          required
        />
        <small>UX recomendada: 50 m a 5 km; banco suporta até 100 km.</small>
      </label>
      <label>
        Quando exibir ao entrar na área?
        <select
          name={playbackModeOverride === 'max_wait' ? undefined : 'playbackModeOverride'}
          value={playbackModeOverride}
          onChange={(event) => setPlaybackModeOverride(event.target.value)}
        >
          <option value="">
            Usar a campanha
            {selectedCampaign
              ? ` (${PLAYBACK_MODE_LABEL[selectedCampaign.playback_mode ?? 'after_current']})`
              : ''}
          </option>
          <option value="immediate">Imediatamente</option>
          <option value="after_current">Depois do anúncio atual</option>
          <option value="max_wait">Esperar no máximo</option>
        </select>
        <small>
          {playbackModeOverride === 'immediate' &&
            'Interrompe o anúncio comum e mostra esta campanha GEO.'}
          {playbackModeOverride === 'after_current' &&
            'Espera o conteúdo atual terminar.'}
          {playbackModeOverride === 'max_wait' &&
            'Espera alguns segundos e depois interrompe.'}
          {playbackModeOverride === '' &&
            'Usa o mesmo comportamento configurado na campanha.'}
        </small>
      </label>
      {playbackModeOverride === 'max_wait' && (
        <label>
          Tempo máximo de espera (segundos)
          <input
            name="maxWaitSecondsOverride"
            type="number"
            min="1"
            max="30"
            value={maxWaitSecondsOverride}
            onChange={(event) =>
              setMaxWaitSecondsOverride(Number(event.target.value) || 1)
            }
            required
          />
        </label>
      )}
      <label>
        Prioridade do anúncio GEO
        <select
          name={priorityPreset === 'custom' ? undefined : 'priorityOverride'}
          value={priorityPreset}
          onChange={(event) => setPriorityPreset(event.target.value)}
        >
          <option value="">
            Usar a campanha
            {selectedCampaign ? ` (${selectedCampaign.priority ?? 50})` : ''}
          </option>
          <option value="5">Normal</option>
          <option value="10">Alta</option>
          <option value="20">Urgente</option>
          {priorityPreset === 'custom' && (
            <option value="custom">Valor atual ({priorityCustomValue})</option>
          )}
        </select>
        <small>
          {priorityPreset === '5' && 'Usada na maioria das campanhas.'}
          {priorityPreset === '10' && 'Passa antes das campanhas normais.'}
          {priorityPreset === '20' &&
            'Tem preferência máxima e deve ser usada apenas em casos especiais.'}
        </small>
      </label>
      {priorityPreset === 'custom' && (
        <input
          name="priorityOverride"
          type="hidden"
          value={priorityCustomValue}
        />
      )}
      <label>
        Tempo para permitir nova exibição
        <select
          name={cooldownPreset === 'custom' ? undefined : 'cooldownOverrideSeconds'}
          value={cooldownPreset}
          onChange={(event) => setCooldownPreset(event.target.value)}
        >
          <option value="">
            Usar a campanha
            {selectedCampaign
              ? ` (${Math.round((selectedCampaign.cooldown_seconds ?? 0) / 60)} min)`
              : ''}
          </option>
          <option value="60">1 minuto</option>
          <option value="300">5 minutos</option>
          <option value="600">10 minutos</option>
          <option value="900">15 minutos</option>
          <option value="1800">30 minutos</option>
          <option value="custom">Personalizado</option>
        </select>
        <small>
          Depois que o anúncio GEO for exibido, este é o tempo mínimo para
          ele poder aparecer novamente em uma nova entrada na área.
        </small>
      </label>
      {cooldownPreset === 'custom' && (
        <label>
          Tempo personalizado (segundos)
          <input
            name="cooldownOverrideSeconds"
            type="number"
            min="0"
            max="86400"
            value={cooldownCustomValue}
            onChange={(event) =>
              setCooldownCustomValue(Number(event.target.value) || 0)
            }
            required
          />
        </label>
      )}
      <label className="checkbox-field">
        <input
          name="active"
          type="checkbox"
          defaultChecked={geofence?.active ?? true}
        />
        Geofence ativa
      </label>
      <div className="full-field">
        {selectedEstablishment?.latitude != null &&
        selectedEstablishment?.longitude != null ? (
          <>
            <LocationMap
              latitude={selectedEstablishment.latitude}
              longitude={selectedEstablishment.longitude}
              radiusMeters={radiusMeters > 0 ? radiusMeters : undefined}
              label={selectedEstablishment.name ?? 'Geofence'}
            />
            <p className="section-hint">
              Ponto herdado de {selectedEstablishment.name} — para mover o
              ponto em si, edite o estabelecimento.
            </p>
          </>
        ) : (
          <div className="map-preview">
            <span>◎</span>
            <div>
              <strong>Localização herdada do estabelecimento</strong>
              <p>Selecione um estabelecimento para ver o ponto e o raio no mapa.</p>
            </div>
          </div>
        )}
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
