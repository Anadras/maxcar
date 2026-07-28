'use client';

export default function CampaignError({ reset }: { reset: () => void }) {
  return (
    <div className="page error-state">
      <h1>Não foi possível carregar as campanhas</h1>
      <p>Tente novamente sem perder os dados já persistidos.</p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}
