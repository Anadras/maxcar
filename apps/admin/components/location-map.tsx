'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';

// Leaflet's default marker images resolve relative to the page URL under
// Next.js's bundler and 404 against our own dynamic routes. A self-contained
// SVG divIcon avoids depending on any bundled or external image asset.
const pinIcon = L.divIcon({
  className: 'location-map-pin',
  html: '<span>◉</span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** react-leaflet only reads MapContainer's `center` prop on first mount —
 * this keeps the view in sync whenever the coordinates change afterward
 * (e.g. a pasted coordinate string updates the fields). Only recenters
 * when the *external* latitude/longitude change, never on every render,
 * so it doesn't fight a user who's mid-drag or mid-pan. */
function RecenterOnChange({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom(), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only on lat/lng change, not on every map/zoom render
  }, [latitude, longitude]);
  return null;
}

/** Reports the map's live center as the operator pans, so "Usar centro do
 * mapa" can place the marker there without requiring a drag or a click. */
function MapCenterTracker({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    moveend: (event) => {
      const center = event.target.getCenter();
      onCenterChange(center.lat, center.lng);
    },
  });
  return null;
}

/** Clicking anywhere on the map places the marker there — only wired up
 * when the map is interactive (an onPositionChange callback was given). */
function ClickToPosition({ onPositionChange }: { onPositionChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      onPositionChange(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export function LocationMap({
  latitude,
  longitude,
  radiusMeters,
  label,
  onPositionChange,
  onCenterChange,
}: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  label: string;
  /** Present only on the create/edit forms — turns the map interactive
   * (draggable marker, click-to-place) and reports the new point back.
   * Absent on read-only detail-page views, which behave exactly as
   * before: a plain marker, no interaction. */
  onPositionChange?: (latitude: number, longitude: number) => void;
  /** Reports the map's live center as the operator pans — lets "Usar
   * centro do mapa" work without needing its own drag/click first. */
  onCenterChange?: (latitude: number, longitude: number) => void;
}) {
  const interactive = Boolean(onPositionChange);
  return (
    <div className="location-map" aria-label={`Mapa: ${label}`}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={radiusMeters ? 15 : 16}
        scrollWheelZoom={interactive}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterOnChange latitude={latitude} longitude={longitude} />
        {interactive && onCenterChange && <MapCenterTracker onCenterChange={onCenterChange} />}
        {interactive && onPositionChange && <ClickToPosition onPositionChange={onPositionChange} />}
        <Marker
          position={[latitude, longitude]}
          icon={pinIcon}
          draggable={interactive}
          eventHandlers={
            interactive && onPositionChange
              ? {
                  dragend: (event) => {
                    const position = event.target.getLatLng();
                    onPositionChange(position.lat, position.lng);
                  },
                }
              : undefined
          }
        />
        {radiusMeters ? (
          <Circle
            center={[latitude, longitude]}
            radius={radiusMeters}
            pathOptions={{ color: '#2563eb', fillOpacity: 0.12 }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
