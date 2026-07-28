'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/(auth)/actions';

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);
  return (
    <form action={action} className="auth-form">
      <label>
        E-mail
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Senha
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.error && (
        <p className="form-message form-message-error" role="alert">
          {state.error}
        </p>
      )}
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
