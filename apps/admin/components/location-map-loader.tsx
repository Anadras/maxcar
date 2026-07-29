'use client';

import dynamic from 'next/dynamic';

const LocationMap = dynamic(
  () => import('./location-map').then((mod) => mod.LocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="location-map location-map-loading">
        <span>Carregando mapa…</span>
      </div>
    ),
  },
);

export { LocationMap };
