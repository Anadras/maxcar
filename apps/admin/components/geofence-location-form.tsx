'use client';

import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';
import { useState } from 'react';
import { CoordinateInput } from './coordinate-input';

type GeofencePlace = Database['public']['Views']['geofence_admin_view']['Row'];

/** Creates or edits one geofence (place) belonging to an establishment —
 * "vários pontos de exibição" (MAX-020): an establishment can own several
 * of these, each with its own name, point and radius. Distinct from
 * GeofenceForm, which only links an already-existing geofence to a
 * campaign and never touches its location. */
export function GeofenceLocationForm({
  geofence,
  establishmentId,
  establishmentName,
  action,
}: {
  geofence?: GeofencePlace;
  establishmentId: string;
  establishmentName: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [radiusMeters, setRadiusMeters] = useState(
    geofence?.radius_meters ?? 500,
  );

  return (
    <form action={action} className="record-form">
      <input name="establishmentId" type="hidden" value={establishmentId} />
      <label>
        Estabelecimento
        <input value={establishmentName} disabled />
      </label>
      <label>
        Nome da geofence
        <input
          name="name"
          defaultValue={geofence?.name ?? ''}
          placeholder="Ex.: Entrada principal, Estacionamento, Drive-thru"
          required
        />
        <small>
          Um estabelecimento pode ter mais de uma geofence — cada uma com seu
          próprio ponto e raio.
        </small>
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
      <label className="checkbox-field">
        <input
          name="active"
          type="checkbox"
          defaultChecked={geofence?.active ?? true}
        />
        Geofence ativa
      </label>
      <CoordinateInput
        initialLatitude={geofence?.latitude ?? null}
        initialLongitude={geofence?.longitude ?? null}
        radiusMeters={radiusMeters > 0 ? radiusMeters : undefined}
        label={geofence?.name ?? 'Nova geofence'}
      />
      <div className="form-actions full-field">
        <Link
          className="button button-ghost"
          href={`/estabelecimentos/${establishmentId}`}
        >
          Cancelar
        </Link>
        <button className="button button-primary" type="submit">
          Salvar geofence
        </button>
      </div>
    </form>
  );
}
