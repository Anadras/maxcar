'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page error-state">
      <h1>Não foi possível carregar os pilotos</h1>
      <p>Confira a conexão e tente novamente.</p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}
