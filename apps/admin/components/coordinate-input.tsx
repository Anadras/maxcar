'use client';

import { useId, useState } from 'react';
import { LocationMap } from './location-map-loader';
import {
  COORDINATE_MESSAGES,
  COORDINATES_RECOGNIZED_MESSAGE,
  parseCoordinates,
} from '@/lib/coordinates';

type Feedback = { tone: 'success' | 'error'; message: string };

/**
 * Replaces a bare pair of latitude/longitude number inputs with: a
 * free-text field that accepts DMS, decimal (dot or Brazilian comma),
 * and Google Maps links (see lib/coordinates.ts for the full list); an
 * interactive map to place or drag the point instead of typing at all;
 * and the original two number inputs, kept editable for anyone who just
 * wants to nudge a value by hand. All three stay in sync with one piece of
 * state — whichever one changes last wins, nothing here ever guesses
 * silently (see parseCoordinates's own doc on inversion handling).
 */
export function CoordinateInput({
  initialLatitude,
  initialLongitude,
  radiusMeters,
  label,
}: {
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  radiusMeters?: number;
  label: string;
}) {
  const [latitude, setLatitude] = useState<number | null>(initialLatitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(initialLongitude ?? null);
  const [pasteValue, setPasteValue] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const pasteFieldId = useId();

  function recognize(value: string) {
    if (value.trim() === '') {
      setFeedback(null);
      return;
    }
    const result = parseCoordinates(value);
    if (result.ok) {
      setLatitude(result.latitude);
      setLongitude(result.longitude);
      setFeedback({ tone: 'success', message: COORDINATES_RECOGNIZED_MESSAGE });
    } else {
      setFeedback({ tone: 'error', message: COORDINATE_MESSAGES[result.reason] });
    }
  }

  function handleClear() {
    setLatitude(null);
    setLongitude(null);
    setPasteValue('');
    setFeedback(null);
    setMapCenter(null);
  }

  function handleUseMapCenter() {
    if (!mapCenter) return;
    setLatitude(mapCenter.lat);
    setLongitude(mapCenter.lng);
    setFeedback(null);
  }

  const hasPoint = latitude !== null && longitude !== null;

  return (
    <div className="coordinate-input full-field">
      <label htmlFor={pasteFieldId}>
        Cole as coordenadas ou um link do mapa
        <textarea
          id={pasteFieldId}
          rows={2}
          value={pasteValue}
          onChange={(event) => setPasteValue(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text');
            setPasteValue(pasted);
            recognize(pasted);
          }}
          onBlur={(event) => recognize(event.target.value)}
          placeholder={`20°24'21.0"S 54°38'16.7"W\nou\n-20.405833, -54.637972`}
        />
      </label>
      {feedback && (
        <p
          className={`form-message ${
            feedback.tone === 'success' ? 'form-message-success' : 'form-message-error'
          }`}
          role={feedback.tone === 'error' ? 'alert' : undefined}
        >
          {feedback.message}
        </p>
      )}
      {hasPoint && (
        <p className="coordinate-decimal-preview">
          {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
        </p>
      )}
      <div className="coordinate-input-fields">
        <label>
          Latitude
          <input
            name="latitude"
            type="number"
            step="any"
            min="-90"
            max="90"
            value={latitude ?? ''}
            onChange={(event) => {
              setFeedback(null);
              setLatitude(event.target.value === '' ? null : Number(event.target.value));
            }}
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
            value={longitude ?? ''}
            onChange={(event) => {
              setFeedback(null);
              setLongitude(event.target.value === '' ? null : Number(event.target.value));
            }}
            required
          />
        </label>
        <button type="button" className="text-button" onClick={handleClear}>
          Limpar coordenadas
        </button>
      </div>
      {hasPoint ? (
        <>
          <LocationMap
            latitude={latitude!}
            longitude={longitude!}
            radiusMeters={radiusMeters}
            label={label}
            onPositionChange={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
              setFeedback(null);
            }}
            onCenterChange={(lat, lng) => setMapCenter({ lat, lng })}
          />
          <div className="coordinate-input-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={handleUseMapCenter}
              disabled={!mapCenter}
            >
              Usar centro do mapa
            </button>
            <span className="section-hint">
              Arraste o marcador ou clique no mapa para ajustar o ponto.
            </span>
          </div>
        </>
      ) : (
        <div className="map-preview">
          <span>◎</span>
          <div>
            <strong>Nenhum ponto definido ainda</strong>
            <p>Cole coordenadas acima ou informe latitude/longitude para ver o mapa.</p>
          </div>
        </div>
      )}
    </div>
  );
}
