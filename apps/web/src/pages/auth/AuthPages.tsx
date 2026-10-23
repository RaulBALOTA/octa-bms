import { useQuery } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui';
import { AuthRequestError, safeNext, useAuthStore } from '../../stores/auth';
import { requestStepUp, type StepUpMethod } from '../../stores/step-up';
import { AuthCard, FormError, LabeledInput, Notice, OtpInput, passkeyCeremony, PasswordInput, RecoveryCodesPanel } from './components';

interface ErrorBody { code?: string; message?: string; retryAfterSeconds?: number; attemptsRemaining?: number }

/** Runs a signed-in enrollment call, prompting for step-up (password or code) once if required. */
async function withStepUp<T>(call: () => ReturnType<typeof authPost<T>>) {
  const first = await call();
  if (first.ok || first.body.code !== 'STEP_UP_REQUIRED') return first;
  const { method = 'password', methods } = first.body as { method?: StepUpMethod; methods?: StepUpMethod[] };
  return (await requestStepUp(method, methods)) ? call() : first;
}

/** POST for the sign-in flow: sends the CSRF token of the current challenge/session, never retries. */
export async function authPost<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T & ErrorBody }> {
  const { csrfToken } = useAuthStore.getState();
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T & ErrorBody };
}

function usePasswordMin() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => ((await (await fetch('/api/v1/auth/config')).json()) as { passwordMinLength: number }).passwordMinLength,
    staleTime: Infinity,
  }).data ?? 12;
}

function nextTarget(status: string, next: string) {
  if (status === 'MFA_PENDING') return `/auth/mfa?next=${encodeURIComponent(next)}`;
  if (status === 'MFA_ENROLLMENT_REQUIRED') return `/auth/setup-mfa?next=${encodeURIComponent(next)}`;
  return next;
}

// ------------------------------------------------------------------ /login

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const login = useAuthStore((s) => s.login);
  const signedOutReason = useAuthStore((s) => s.signedOutReason);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sso = params.get('sso');

  const { data: ssoStatus } = useQuery({
    queryKey: ['oidc-status'],
    queryFn: async () => ((await (await fetch('/api/v1/auth/oidc/status')).json()) as { enabled: boolean }),
    staleTime: 300_000,
  });

  const notice = signedOutReason === 'SESSION_POLICY_REAUTH' ? t('auth.policyReauth')
    : signedOutReason === 'SIGNED_OUT_ELSEWHERE' ? t('auth.signedOutElsewhere')
    : signedOutReason && signedOutReason !== 'UNAUTHENTICATED' ? t('auth.sessionExpired') : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      navigate(nextTarget(result.status, next), { replace: true });
    } catch (err) {
      const body = err instanceof AuthRequestError ? err.body : {};
      setError(body.code === 'TOO_MANY_ATTEMPTS'
        ? t('auth.tooManyAttempts', { minutes: Math.max(1, Math.ceil((body.retryAfterSeconds ?? 60) / 60)) })
        : t('auth.loginFailed'));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <AuthCard title={t('auth.login')}>
      <p className="-mt-3 mb-5 text-sm text-muted-foreground">{t('auth.brandTagline')}</p>
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={onSubmit} noValidate={false}>
        <FormError message={error} />
        <LabeledInput label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus maxLength={254} />
        <PasswordInput label={t('auth.password')} value={password} onChange={setPassword} />
        <Button type="submit" disabled={busy} className="w-full">{t('auth.login')}</Button>
      </form>
      <p className="mt-3 text-center text-sm"><Link to="/forgot-password" className="text-primary hover:underline">{t('auth.forgotPassword')}</Link></p>
      {ssoStatus?.enabled && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />{t('auth.or')}<span className="h-px flex-1 bg-border" />
          </div>
          <a href="/api/v1/auth/oidc/login" className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm font-medium hover:bg-muted">
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
      {sso && <p role="alert" className="mt-3 text-center text-xs text-destructive">{sso === 'not_invited' ? t('auth.ssoNotInvited') : t('auth.ssoFailed')}</p>}
    </AuthCard>
  );
}

// ------------------------------------------------------------------ /auth/mfa

export function MfaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { status, refreshState, applyResult } = useAuthStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = useQuery({
    queryKey: ['mfa-methods'],
    enabled: status === 'MFA_PENDING',
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/v1/auth/mfa/methods', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('expired');
      return (await res.json()) as { totp: boolean; passkey: boolean; passkeyRequired: boolean; recoveryCode: boolean };
    },
  });

  useEffect(() => { void refreshState(); }, [refreshState]);
  useEffect(() => {
    if (status === 'AUTHENTICATED') navigate(next, { replace: true });
    if (status === 'MFA_ENROLLMENT_REQUIRED') navigate(`/auth/setup-mfa?next=${encodeURIComponent(next)}`, { replace: true });
  }, [status, navigate, next]);

  async function withPasskey() {
    setBusy(true);
    setError(null);
    const result = await passkeyCeremony<{ status: 'AUTHENTICATED'; csrfToken: string }>('/auth/mfa/passkey/options', '/auth/mfa/passkey/verify');
    setBusy(false);
    if (result.ok) applyResult(result.body);
    else setError(t(result.error));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    const res = await authPost<{ status: 'AUTHENTICATED'; csrfToken: string }>('/auth/mfa/verify', { code });
    setBusy(false);
    setCode('');
    if (res.ok) {
      applyResult(res.body);
      return;
    }
    if (res.body.code === 'MFA_CHALLENGE_INVALID') setError(t('auth.mfa.expired'));
    else if (res.body.code === 'TOO_MANY_ATTEMPTS') setError(t('auth.tooManyAttempts', { minutes: Math.ceil((res.body.retryAfterSeconds ?? 60) / 60) }));
    else setError(res.body.attemptsRemaining !== undefined ? t('auth.mfa.invalid', { count: res.body.attemptsRemaining }) : t('auth.mfa.invalidNoCount'));
  }

  if (status === 'ANONYMOUS') {
    return (
      <AuthCard title={t('auth.mfa.title')}>
        <Notice>{t('auth.mfa.expired')}</Notice>
        <Link to="/login" className="text-sm text-primary hover:underline">{t('auth.backToLogin')}</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('auth.mfa.title')} icon={<Smartphone size={18} aria-hidden />}>
      <FormError message={error} />
      {methods.data?.passkey && (
        <div className="mb-4">
          <p className="mb-3 text-sm text-muted-foreground">{methods.data.passkeyRequired ? t('auth.mfa.passkeyRequired') : t('auth.mfa.passkeyPrompt')}</p>
          <Button type="button" className="w-full" onClick={() => void withPasskey()} disabled={busy}>
            <KeyRound size={14} aria-hidden />{t('auth.mfa.usePasskey')}
          </Button>
        </div>
      )}
      {(methods.data?.totp ?? !methods.data) && (
        <>
          {methods.data?.passkey && <p className="mb-3 text-center text-xs text-muted-foreground">{t('auth.mfa.orCode')}</p>}
          <p className="mb-4 text-sm text-muted-foreground">{t('auth.mfa.prompt')}</p>
          <form onSubmit={submit}>
            <OtpInput value={code} onChange={setCode} label={t('auth.mfa.codeLabel')} disabled={busy} autoFocus={!methods.data?.passkey} />
            <Button type="submit" className="w-full" variant={methods.data?.passkey ? 'secondary' : 'primary'} disabled={busy || code.length !== 6}>{busy ? t('auth.mfa.verifying') : t('auth.verify')}</Button>
          </form>
        </>
      )}
      <div className="mt-4 flex flex-col gap-1 text-center text-sm">
        <Link to={`/auth/recovery?next=${encodeURIComponent(next)}`} className="text-primary hover:underline">{t('auth.mfa.useRecovery')}</Link>
        <Link to="/login" className="text-muted-foreground hover:underline">{t('auth.backToLogin')}</Link>
      </div>
    </AuthCard>
  );
}

// ------------------------------------------------------------------ /auth/recovery

export function RecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { refreshState, applyResult } = useAuthStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => { void refreshState(); }, [refreshState]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authPost<{ status: 'AUTHENTICATED'; csrfToken: string; recoveryCodesRemaining: number }>('/auth/mfa/recovery', { code: code.trim() });
    setCode('');
    if (res.ok) {
      applyResult(res.body);
      setDone(res.body.recoveryCodesRemaining);
      return;
    }
    setError(res.body.code === 'MFA_CHALLENGE_INVALID' ? t('auth.mfa.expired') : res.body.code === 'TOO_MANY_ATTEMPTS' ? t('auth.tooManyAttempts', { minutes: Math.ceil((res.body.retryAfterSeconds ?? 60) / 60) }) : t('auth.recovery.invalid'));
  }

  if (done !== null) {
    return (
      <AuthCard title={t('auth.recovery.title')} icon={<KeyRound size={18} aria-hidden />}>
        <Notice>{t('auth.recovery.remaining', { count: done })}</Notice>
        <Button className="w-full" onClick={() => navigate(done <= 3 ? '/security' : next, { replace: true })}>{t('auth.continue')}</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('auth.recovery.title')} icon={<KeyRound size={18} aria-hidden />}>
      <p className="mb-2 text-sm text-muted-foreground">{t('auth.recovery.prompt')}</p>
      <p className="mb-4 text-xs text-muted-foreground">{t('auth.recovery.oneTime')}</p>
      <form onSubmit={submit}>
        <FormError message={error} />
        <LabeledInput label={t('auth.recovery.codeLabel')} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={16} required autoFocus className="font-mono" />
        <Button type="submit" className="w-full" disabled={code.replace(/[\s-]/g, '').length !== 10}>{t('auth.verify')}</Button>
      </form>
      <div className="mt-4 flex flex-col gap-1 text-center text-sm">
        <Link to={`/auth/mfa?next=${encodeURIComponent(next)}`} className="text-primary hover:underline">{t('auth.mfa.useAuthenticator')}</Link>
        <Link to="/login" className="text-muted-foreground hover:underline">{t('auth.backToLogin')}</Link>
      </div>
    </AuthCard>
  );
}

// ------------------------------------------------------------------ /auth/setup-mfa

interface EnrollmentStart { enrollmentId: string; qrSvg: string; manualKey: string; accountName: string; expiresAt: string }

/**
 * Guided Microsoft Authenticator enrollment. Works for an enrollment-required sign-in
 * (pre-auth challenge) and for signed-in users opting in or replacing their factor.
 * The QR/secret live only in this component's state and are discarded after confirmation.
 */
export function SetupMfaPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { status, refreshState, applyResult, loadMe } = useAuthStore();
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void refreshState(); }, [refreshState]);

  async function start() {
    setError(null);
    setBusy(true);
    const res = await withStepUp(() => authPost<EnrollmentStart>('/auth/mfa/enroll/start'));
    setBusy(false);
    if (res.ok) setEnrollment(res.body);
    else if (res.body.code === 'STEP_UP_REQUIRED') setError(t('auth.stepUp.invalid'));
    else setError(res.body.code === 'MFA_CHALLENGE_INVALID' ? t('auth.mfa.expired') : res.body.message ?? t('auth.setup.expired'));
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const res = await withStepUp(() => authPost<{ status: 'AUTHENTICATED'; csrfToken: string; recoveryCodes: string[] }>('/auth/mfa/enroll/confirm', { enrollmentId: enrollment.enrollmentId, code }));
    setBusy(false);
    setCode('');
    if (!res.ok) {
      if (res.body.code === 'MFA_ENROLLMENT_INVALID') { setEnrollment(null); setError(t('auth.setup.expired')); }
      else if (res.body.code === 'MFA_CHALLENGE_INVALID') setError(t('auth.mfa.expired'));
      else setError(t('auth.setup.invalidCode'));
      return;
    }
    setEnrollment(null); // drop the QR and secret from memory immediately
    applyResult(res.body);
    setCodes(res.body.recoveryCodes);
  }

  if (codes) {
    return (
      <AuthCard title={t('auth.codes.title')} icon={<ShieldCheck size={18} aria-hidden />}>
        <RecoveryCodesPanel codes={codes} onDone={() => { setCodes(null); void loadMe(); navigate(next, { replace: true }); }} />
      </AuthCard>
    );
  }
  if (status === 'ANONYMOUS' || status === 'MFA_PENDING') {
    return (
      <AuthCard title={t('auth.setup.title')}>
        <Notice>{t('auth.mfa.expired')}</Notice>
        <Link to="/login" className="text-sm text-primary hover:underline">{t('auth.backToLogin')}</Link>
      </AuthCard>
    );
  }
  const qrSrc = enrollment ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrSvg)}` : null;
  return (
    <AuthCard title={t('auth.setup.title')} icon={<Smartphone size={18} aria-hidden />}>
      {status === 'MFA_ENROLLMENT_REQUIRED' && <Notice>{t('auth.setup.required')}</Notice>}
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        {(['step1', 'step2', 'step3', 'step4', 'step5'] as const).map((step) => <li key={step}>{t(`auth.setup.${step}`)}</li>)}
      </ol>
      <FormError message={error} />
      {!enrollment ? (
        <Button className="w-full" onClick={() => void start()} disabled={busy}>{t('auth.setup.start')}</Button>
      ) : (
        <form onSubmit={confirm}>
          <div className="mb-3 flex justify-center rounded-md bg-white p-2">
            <img src={qrSrc!} alt={t('auth.setup.qrAlt')} width={200} height={200} />
          </div>
          <details className="mb-3 text-sm">
            <summary className="cursor-pointer text-primary">{t('auth.setup.manualKey')}</summary>
            <p className="mt-2 select-all break-all rounded bg-muted px-2 py-1.5 font-mono text-sm" aria-label={t('auth.setup.manualKey')}>{enrollment.manualKey}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('auth.setup.manualHint', { account: enrollment.accountName })}</p>
          </details>
          <OtpInput value={code} onChange={setCode} label={t('auth.mfa.codeLabel')} autoFocus={false} />
          <p className="mb-3 text-xs text-muted-foreground">{t('auth.setup.expiresAt', { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(enrollment.expiresAt)) })}</p>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{t('auth.setup.confirm')}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><button type="button" className="text-muted-foreground hover:underline" onClick={() => void useAuthStore.getState().logout().then(() => navigate('/login'))}>{t('auth.logout')}</button></p>
    </AuthCard>
  );
}

// ------------------------------------------------------------------ password reset

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authPost('/auth/password/forgot', { email: email.trim() });
    if (res.status === 429) setError(t('auth.tooManyAttempts', { minutes: Math.ceil((res.body.retryAfterSeconds ?? 60) / 60) }));
    else setSent(true); // identical outcome whether or not the account exists
  }
  return (
    <AuthCard title={t('auth.forgot.title')}>
      {sent ? <Notice>{t('auth.forgot.sent')}</Notice> : (
        <form onSubmit={submit}>
          <p className="mb-4 text-sm text-muted-foreground">{t('auth.forgot.prompt')}</p>
          <FormError message={error} />
          <LabeledInput label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus maxLength={254} />
          <Button type="submit" className="w-full">{t('auth.forgot.submit')}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link to="/login" className="text-primary hover:underline">{t('auth.backToLogin')}</Link></p>
    </AuthCard>
  );
}

/** Reads `#token=…` from the fragment (never sent to servers) and scrubs it from history. */
function useFragmentToken(): string | null {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); }, []);
  return token;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const min = usePasswordMin();
  const token = useFragmentToken();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) { setError(t('auth.reset.mismatch')); return; }
    const res = await authPost('/auth/password/reset', { token, password });
    if (res.ok) setDone(true);
    else setError(res.body.code === 'PASSWORD_POLICY' ? res.body.message ?? '' : t('auth.reset.invalid'));
  }
  return (
    <AuthCard title={t('auth.reset.title')} icon={<KeyRound size={18} aria-hidden />}>
      {done ? <Notice>{t('auth.reset.done')}</Notice> : !token ? <Notice>{t('auth.reset.invalid')}</Notice> : (
        <form onSubmit={submit}>
          <FormError message={error} />
          <PasswordInput label={t('auth.reset.newPassword')} value={password} onChange={setPassword} autoComplete="new-password" hint={t('auth.passwordHint', { min })} autoFocus />
          <PasswordInput label={t('auth.reset.confirmPassword')} value={repeat} onChange={setRepeat} autoComplete="new-password" />
          <Button type="submit" className="w-full" disabled={password.length < min}>{t('auth.reset.submit')}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link to="/login" className="text-primary hover:underline">{t('auth.backToLogin')}</Link></p>
    </AuthCard>
  );
}

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const min = usePasswordMin();
  const token = useFragmentToken();
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      const res = await authPost<{ email: string; companyName: string }>('/auth/invitations/preview', { token });
      if (!res.ok) throw new Error('invalid');
      return res.body;
    },
  });
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await authPost('/auth/invitations/accept', { token, ...form });
    if (res.ok) setDone(true);
    else setError(res.body.code === 'PASSWORD_POLICY' ? res.body.message ?? '' : t('auth.invite.invalid'));
  }
  return (
    <AuthCard title={t('auth.invite.title')}>
      {done ? (
        <>
          <Notice>{t('auth.invite.done')}</Notice>
          <Link to="/login" className="text-sm text-primary hover:underline">{t('auth.login')}</Link>
        </>
      ) : !token || preview.isError ? <Notice>{t('auth.invite.invalid')}</Notice> : !preview.data ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : (
        <form onSubmit={submit}>
          <p className="mb-4 text-sm text-muted-foreground">{t('auth.invite.for', { email: preview.data.email, company: preview.data.companyName })}</p>
          <FormError message={error} />
          <LabeledInput label={t('auth.invite.firstName')} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" required maxLength={80} />
          <LabeledInput label={t('auth.invite.lastName')} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" required maxLength={80} />
          <input type="email" value={preview.data.email} autoComplete="username" readOnly hidden />
          <PasswordInput label={t('auth.password')} value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" hint={t('auth.passwordHint', { min })} />
          <Button type="submit" className="w-full" disabled={form.password.length < min}>{t('auth.invite.submit')}</Button>
        </form>
      )}
    </AuthCard>
  );
}
