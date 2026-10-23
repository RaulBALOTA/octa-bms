import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const ssoError = params.get('sso');

  const { data: sso } = useQuery({
    queryKey: ['oidc-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/auth/oidc/status');
      return (await res.json()) as { enabled: boolean };
    },
    staleTime: 300_000,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError(t('auth.loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-lg"
      >
        <h1 className="mb-1 text-xl font-bold">{t('app.name')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Business Management System
        </p>

        <label className="mb-1 block text-sm font-medium">
          {t('auth.email')}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />

        <label className="mb-1 block text-sm font-medium">
          {t('auth.password')}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />

        {error && (
          <p className="mb-3 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {t('auth.login')}
        </button>

        {sso?.enabled && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('auth.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <a
              href="/api/v1/auth/oidc/login"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm font-medium hover:bg-muted"
            >
              <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden>
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              {t('auth.microsoftLogin')}
            </a>
          </>
        )}
        {ssoError && (
          <p className="mt-3 text-center text-xs text-destructive">
            {t('auth.ssoFailed')} ({ssoError})
          </p>
        )}
      </form>
    </div>
  );
}
