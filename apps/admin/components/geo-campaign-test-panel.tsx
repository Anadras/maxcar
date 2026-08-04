'use client';

import { useActionState } from 'react';
import type { GeoTestState } from '@/app/(protected)/campanhas/[id]/geo-test-actions';
import { SubmitButton } from './submit-button';

const initialState: GeoTestState = {};

export function GeoCampaignTestPanel({
  devices,
  action,
}: {
  devices: Array<{ id: string; deviceCode: string }>;
  action: (state: GeoTestState, formData: FormData) => Promise<GeoTestState>;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const overallEligible =
    state.result &&
    state.result.campaignActive &&
    state.result.withinScheduleWindow &&
    state.result.structurallyReady &&
    state.result.deviceAllowed &&
    state.result.geofences.some((g) => g.insideRadius);

  return (
    <div className="simulation-panel">
      <form action={formAction} className="simulation-form">
        <label>
          Tablet
          <select name="deviceId" required defaultValue="">
            <option value="" disabled>
              Selecione um tablet
            </option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.deviceCode}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton pendingLabel="Simulando…">
          Testar campanha GEO neste dispositivo
        </SubmitButton>
      </form>
      {state.error && (
        <p className="form-message form-message-error" role="alert">
          {state.error}
        </p>
      )}
      {state.result && (
        <div
          className={`simulation-result ${overallEligible ? 'eligible' : 'not-eligible'}`}
        >
          <span>{overallEligible ? '✓' : '!'}</span>
          <div>
            <strong>
              [SIMULADO]{' '}
              {overallEligible
                ? 'Este tablet receberia o anúncio agora'
                : 'Este tablet não receberia o anúncio agora'}
            </strong>
            <ul className="geo-test-reasons">
              <li>
                Campanha ativa e dentro do período:{' '}
                {state.result.campaignActive && state.result.withinScheduleWindow
                  ? 'sim'
                  : 'não'}
              </li>
              <li>
                Campanha completa (arquivo e local definidos):{' '}
                {state.result.structurallyReady ? 'sim' : 'não'}
              </li>
              <li>
                Este tablet está liberado para a campanha:{' '}
                {state.result.deviceAllowed ? 'sim' : 'não'}
              </li>
              {!state.result.deviceHasKnownLocation && (
                <li>
                  Este tablet nunca reportou uma localização — a distância não
                  pôde ser calculada.
                </li>
              )}
              {state.result.geofences.map((geofence, index) => (
                <li key={index}>
                  {geofence.establishmentName}: raio {geofence.radiusMeters} m
                  {geofence.distanceMeters !== null
                    ? ` · distância da última localização conhecida ${Math.round(geofence.distanceMeters)} m (${geofence.insideRadius ? 'dentro do raio' : 'fora do raio'})`
                    : ' · distância desconhecida'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
