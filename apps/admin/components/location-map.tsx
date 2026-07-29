'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet';

// Leaflet's default marker images resolve relative to the page URL under
// Next.js's bundler and 404 against our own dynamic routes. A self-contained
// SVG divIcon avoids depending on any bundled or external image asset.
const pinIcon = L.divIcon({
  className: 'location-map-pin',
  html: '<span>◉</span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export function LocationMap({
  latitude,
  longitude,
  radiusMeters,
  label,
}: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  label: string;
}) {
  return (
    <div className="location-map" aria-label={`Mapa: ${label}`}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={radiusMeters ? 15 : 16}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[latitude, longitude]} icon={pinIcon} />
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
