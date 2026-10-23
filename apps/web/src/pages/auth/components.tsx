import clsx from 'clsx';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useStepUpStore } from '../../stores/step-up';
import { Button, Dialog } from '../../components/ui';

/** Centered card used by every sign-in page; moves focus to the heading for screen readers. */
export function AuthCard({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [title]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg sm:p-8" aria-labelledby="auth-title">
        <div className="mb-5 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('app.name')}</p>
            <h1 id="auth-title" ref={heading} tabIndex={-1} className="mt-1 flex items-center gap-2 text-lg font-bold outline-none">
              {icon}
              {title}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setLanguage(i18n.language === 'de' ? 'en' : 'de')}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            aria-label={i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten'}
          >
            {i18n.language === 'de' ? 'EN' : 'DE'}
          </button>
        </div>
        {children}
      </section>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" aria-live="assertive" className={message ? 'mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive' : 'sr-only'}>
      {message ?? ''}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{children}</p>;
}

const fieldClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary';

export function LabeledInput({ label, hint, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} className={clsx(fieldClass, className)} />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Password field with show/hide toggle; paste and password managers allowed. */
export function PasswordInput({ label, hint, autoComplete = 'current-password', value, onChange, autoFocus }: {
  label: string; hint?: string; autoComplete?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          maxLength={256}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`${fieldClass} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Six-digit one-time code: numeric keypad, OS/password-manager autofill, paste of "123 456". */
export function OtpInput({ value, onChange, label, autoFocus = true, disabled }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input
        id={id}
        name="one-time-code"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={7}
        autoFocus={autoFocus}
        disabled={disabled}
        required
        className={`${fieldClass} text-center font-mono text-2xl tracking-[0.5em]`}
      />
    </div>
  );
}

/** One-time display of recovery codes with copy/download and an explicit acknowledgement. */
export function RecoveryCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `${t('auth.codes.fileHeader')}\n\n${codes.join('\n')}\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'octa-bms-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">{t('auth.codes.intro')}</p>
      <ol className="mb-3 grid grid-cols-2 gap-1.5 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm" aria-label={t('auth.codes.title')}>
        {codes.map((code) => <li key={code} className="select-all">{code}</li>)}
      </ol>
      <div className="mb-4 flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={download}>{t('auth.codes.download')}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
          {copied ? t('auth.copied') : t('auth.codes.copyAll')}
        </Button>
      </div>
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        {t('auth.codes.ack')}
      </label>
      <Button type="button" className="w-full" disabled={!ack} onClick={onDone}>{t('auth.continue')}</Button>
    </div>
  );
}

/** Global step-up prompt opened by the API client on 403 STEP_UP_REQUIRED. */
export function StepUpDialog() {
  const { t } = useTranslation();
  const { open, method, finish } = useStepUpStore();
  const setCsrf = useAuthStore((s) => s.setCsrf);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setValue(''); setError(null); } }, [open]);
  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { csrfToken } = useAuthStore.getState();
    const res = await fetch('/api/v1/auth/step-up/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: JSON.stringify(method === 'totp' ? { code: value } : { password: value }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t('auth.stepUp.invalid'));
      return;
    }
    const body = (await res.json()) as { csrfToken: string };
    setCsrf(body.csrfToken);
    finish(true);
  }

  return (
    <Dialog open title={t('auth.stepUp.title')} onClose={() => finish(false)}>
      <form onSubmit={submit}>
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck size={16} aria-hidden />{t(method === 'totp' ? 'auth.stepUp.totp' : 'auth.stepUp.password')}</p>
        <FormError message={error} />
        {method === 'totp'
          ? <OtpInput value={value} onChange={setValue} label={t('auth.mfa.codeLabel')} />
          : <PasswordInput label={t('auth.password')} value={value} onChange={setValue} autoFocus />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => finish(false)}>{t('auth.cancel')}</Button>
          <Button type="submit" disabled={busy || (method === 'totp' && value.length !== 6)}>{t('auth.verify')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
