'use client';

import { useActionState } from 'react';
import type { SimulationState } from '@/app/(protected)/geofences/actions';
import { SubmitButton } from './submit-button';

const initialState: SimulationState = {};

export function GeofenceSimulator({
  action,
  initialLatitude,
  initialLongitude,
}: {
  action: (
    state: SimulationState,
    formData: FormData,
  ) => Promise<SimulationState>;
  initialLatitude: number;
  initialLongitude: number;
}) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <div className="simulation-panel">
      <form action={formAction} className="simulation-form">
        <label>
          Latitude do veículo
          <input
            name="latitude"
            type="number"
            step="any"
            min="-90"
            max="90"
            defaultValue={initialLatitude}
            required
          />
        </label>
        <label>
          Longitude do veículo
          <input
            name="longitude"
            type="number"
            step="any"
            min="-180"
            max="180"
            defaultValue={initialLongitude}
            required
          />
        </label>
        <SubmitButton pendingLabel="Calculando no PostGIS…">
          Simular posição do veículo
        </SubmitButton>
      </form>
      {state.error && (
        <p className="form-message form-message-error" role="alert">
          {state.error}
        </p>
      )}
      {state.result && (
        <div
          className={`simulation-result ${
            state.result.eligible ? 'eligible' : 'not-eligible'
          }`}
        >
          <span>{state.result.eligible ? '✓' : '!'}</span>
          <div>
            <strong>
              {state.result.eligible
                ? 'Campanha elegível'
                : state.result.withinRadius
                  ? 'Dentro do raio, mas fora das regras'
                  : 'Veículo fora do raio'}
            </strong>
            <p>
              Distância {Math.round(state.result.distanceMeters)} m · raio{' '}
              {state.result.radiusMeters} m
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
