import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MAXCAR</strong>
            <span>MEDIA NETWORK</span>
          </div>
        </div>
        <p className="eyebrow">ACESSO SEGURO</p>
        <h1>Entre na operação</h1>
        <p>Use sua conta autorizada para acessar o painel.</p>
        <LoginForm />
      </section>
    </main>
  );
}
