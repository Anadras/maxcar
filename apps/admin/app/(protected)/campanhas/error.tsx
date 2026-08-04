'use client';

import { useEffect } from 'react';

export default function CampaignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Campaign page failed', error);
  }, [error]);

  return (
    <div className="page error-state">
      <h1>Não foi possível carregar as campanhas</h1>
      <p>
        Seus dados continuam salvos. Atualize a página; se o problema continuar,
        volte para a lista de campanhas.
      </p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
      {error.digest && <small>Código de suporte: {error.digest}</small>}
    </div>
  );
}
