'use client';

export default function GeofenceError({ reset }: { reset: () => void }) {
  return (
    <div className="page error-state">
      <h1>Não foi possível carregar as geofences</h1>
      <p>A simulação não alterou nenhum dado.</p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}
