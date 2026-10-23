import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Mail } from 'lucide-react';
import { NAV_ITEMS } from '../app/nav';
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
    <div className="flex min-h-screen bg-background">
      {/* brand panel */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0d366b] via-[#1c5cab] to-[#6250d6] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-[#3987e5]/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-black backdrop-blur">
            O
          </span>
          <span className="text-lg font-bold tracking-tight">{t('app.name')}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">{t('shell.loginTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/80">{t('shell.loginTagline')}</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {NAV_ITEMS.filter((item) => ['crm', 'contracts', 'finance', 'hr', 'legal', 'bi'].includes(item.key)).map((item) => (
              <div key={item.key} className="flex flex-col items-start gap-2 rounded-xl bg-white/10 p-3 backdrop-blur">
                <item.icon size={18} />
                <span className="text-xs font-medium">{t(`nav.${item.key}`)}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-white/60">Business Management System</p>
      </aside>

      <div className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#6250d6] font-black text-white">
            O
          </span>
          <span className="font-bold">{t('app.name')}</span>
        </div>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('shell.loginWelcome')}</h1>
        <p className="mb-7 text-sm text-muted-foreground">{t('shell.loginHint')}</p>

        <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium">
          {t('auth.email')}
        </label>
        <div className="relative mb-4">
          <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium">
          {t('auth.password')}
        </label>
        <div className="relative mb-5">
          <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error && (
          <p className="mb-3 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-r from-primary to-[#6250d6] py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
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
    </div>
  );
}
