import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Fingerprint, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Field, TextInput, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

type Mode = 'DISABLED' | 'OPTIONAL' | 'ENROLLMENT_REQUIRED' | 'ENFORCED';
const MODES: Mode[] = ['DISABLED', 'OPTIONAL', 'ENROLLMENT_REQUIRED', 'ENFORCED'];

interface Policy {
  mfaMode: Mode;
  enrollmentDeadline: string | null;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  stepUpMaxAgeMinutes: number;
  passkeysEnabled: boolean;
  requirePasskeyForAdmins: boolean;
  source: 'database' | 'environment';
}
interface Overview { users: number; enrolled: number; enrolledAdmins: number; systemAdmins: number; adminsWithPasskey: number; policy: Policy }
interface Config {
  totp: { issuer: string; algorithm: string; digits: number; periodSeconds: number; windowSteps: number };
  challenge: { preAuthTtlSeconds: number; maxAttempts: number };
  sessionDefaults: { idleMinutes: number; absoluteHours: number; stepUpMaxAgeMinutes: number };
  passkeys: { rpId: string };
  passwords: { minLength: number; breachedCheck: boolean };
  email: { configured: boolean };
  encryptionKey: { id: string; development: boolean };
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby={id}>
      <h2 id={id} className="mb-3 flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" aria-hidden /> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
      <span>{children}<span className="sr-only">{ok ? ' ✓' : ' ✗'}</span></span>
    </li>
  );
}

function Toggle({ label, help, checked, disabled, onChange }: { label: string; help?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" aria-describedby={help ? `${id}-help` : undefined} />
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {help && <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>}
      </div>
    </div>
  );
}

/**
 * Organization MFA configuration (system administrators edit; security admins read).
 * The server enforces every guard rail (≥2 MFA admins for enforcement, every admin with a
 * passkey before passkeys are required) and requires a recent second factor to save.
 */
export function MfaConfigPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isSystemAdmin = useAuthStore((s) => !!s.me?.isSystemAdmin);
  const overview = useQuery({ queryKey: ['sec-overview', 'mfa-config'], queryFn: () => api.get<Overview>('/admin/security/overview') });
  const config = useQuery({ queryKey: ['sec-config'], queryFn: () => api.get<Config>('/admin/security/config') });
  const [draft, setDraft] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (overview.data && !draft) setDraft(overview.data.policy); }, [overview.data, draft]);

  const save = useMutation({
    mutationFn: () => api.patch<Policy>('/admin/security/policy', {
      mfaMode: draft!.mfaMode,
      enrollmentDeadline: draft!.enrollmentDeadline ? new Date(draft!.enrollmentDeadline).toISOString() : null,
      sessionIdleMinutes: Number(draft!.sessionIdleMinutes),
      sessionAbsoluteHours: Number(draft!.sessionAbsoluteHours),
      stepUpMaxAgeMinutes: Number(draft!.stepUpMaxAgeMinutes),
      passkeysEnabled: draft!.passkeysEnabled,
      requirePasskeyForAdmins: draft!.requirePasskeyForAdmins,
    }),
    onSuccess: (policy) => {
      setDraft(policy);
      setError(null);
      toast(t('auth.mfaConfig.saved'));
      void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('sec-') });
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const o = overview.data;
  const c = config.data;
  const saved = o?.policy;
  const dirty = !!draft && !!saved && JSON.stringify({ ...draft, source: '' }) !== JSON.stringify({ ...saved, source: '' });
  const readOnly = !isSystemAdmin;
  if (!draft || !o) return <p className="p-8 text-center text-sm text-muted-foreground" role="status">{t('common.loading')}</p>;
  const set = (patch: Partial<Policy>) => setDraft({ ...draft, ...patch });

  return (
    <form className="mx-auto max-w-4xl space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={20} aria-hidden />{t('auth.mfaConfig.title')}</h1>
        <div className="flex-1" />
        <Link to="/admin/security" className="text-sm text-primary hover:underline">{t('auth.admin.title')}</Link>
      </div>
      <p className="text-sm text-muted-foreground">{t('auth.mfaConfig.intro')}</p>
      {readOnly && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">{t('auth.mfaConfig.readOnly')}</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Section title={t('auth.mfaConfig.readiness')} icon={<CheckCircle2 size={16} aria-hidden />}>
        <ul className="space-y-1.5">
          <Check ok={o.enrolledAdmins >= 2}>{t('auth.mfaConfig.checkAdmins', { count: o.enrolledAdmins })}</Check>
          <Check ok={o.systemAdmins > 0 && o.adminsWithPasskey === o.systemAdmins}>{t('auth.mfaConfig.checkAdminPasskeys', { with: o.adminsWithPasskey, total: o.systemAdmins })}</Check>
          <Check ok={o.users > 0 && o.enrolled === o.users}>{t('auth.mfaConfig.checkEnrollment', { enrolled: o.enrolled, users: o.users })}</Check>
          {c && <Check ok={c.email.configured}>{t('auth.mfaConfig.checkEmail')}</Check>}
          {c && <Check ok={!c.encryptionKey.development}>{t('auth.mfaConfig.checkKey')} ({c.encryptionKey.id})</Check>}
        </ul>
      </Section>

      <Section title={t('auth.mfaConfig.modeTitle')} icon={<ShieldCheck size={16} aria-hidden />}>
        <fieldset disabled={readOnly}>
          <legend className="sr-only">{t('auth.admin.mode')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((mode) => (
              <label key={mode} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${draft.mfaMode === mode ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <input type="radio" name="mfaMode" value={mode} checked={draft.mfaMode === mode} onChange={() => set({ mfaMode: mode })} className="mt-0.5" />
                <span><span className="font-medium">{t(`auth.admin.modes.${mode}`)}</span><span className="block text-xs text-muted-foreground">{t(`auth.mfaConfig.modeHelp.${mode}`)}</span></span>
              </label>
            ))}
          </div>
          {draft.mfaMode === 'ENROLLMENT_REQUIRED' && (
            <Field label={t('auth.admin.deadline')} className="mt-3 max-w-xs">
              <TextInput type="datetime-local" value={draft.enrollmentDeadline ? draft.enrollmentDeadline.slice(0, 16) : ''} onChange={(e) => set({ enrollmentDeadline: e.target.value || null })} />
            </Field>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t('auth.admin.policyHelp')} {t('auth.mfaConfig.pilotLink')}</p>
        </fieldset>
      </Section>

      <Section title={t('auth.mfaConfig.methodsTitle')} icon={<KeyRound size={16} aria-hidden />}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Smartphone size={18} className="mt-0.5 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t('auth.mfaConfig.totpTitle')} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{t('auth.mfaConfig.alwaysOn')}</span></p>
              {c && <p className="text-xs text-muted-foreground">{t('auth.mfaConfig.totpDetail', { algorithm: c.totp.algorithm, digits: c.totp.digits, period: c.totp.periodSeconds, window: c.totp.windowSteps, issuer: c.totp.issuer })}</p>}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Fingerprint size={18} className="mt-0.5 text-muted-foreground" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('auth.mfaConfig.passkeysTitle')}</p>
              {c && <p className="text-xs text-muted-foreground">{t('auth.mfaConfig.passkeysDetail', { rpId: c.passkeys.rpId })}</p>}
              <Toggle label={t('auth.mfaConfig.passkeysEnabled')} checked={draft.passkeysEnabled} disabled={readOnly}
                onChange={(v) => set({ passkeysEnabled: v, requirePasskeyForAdmins: v && draft.requirePasskeyForAdmins })} />
              <Toggle label={t('auth.mfaConfig.requirePasskeys')} help={t('auth.mfaConfig.requirePasskeysHelp')} checked={draft.requirePasskeyForAdmins}
                disabled={readOnly || !draft.passkeysEnabled} onChange={(v) => set({ requirePasskeyForAdmins: v })} />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t('auth.mfaConfig.recoveryTitle')} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{t('auth.mfaConfig.alwaysOn')}</span></p>
              <p className="text-xs text-muted-foreground">{t('auth.mfaConfig.recoveryDetail')}</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t('auth.mfaConfig.sessionsTitle')} icon={<ShieldCheck size={16} aria-hidden />}>
        <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-3">
          <Field label={t('auth.admin.idle')}>
            <TextInput type="number" min={5} max={1440} value={draft.sessionIdleMinutes} onChange={(e) => set({ sessionIdleMinutes: Number(e.target.value) })} />
          </Field>
          <Field label={t('auth.admin.absolute')}>
            <TextInput type="number" min={1} max={336} value={draft.sessionAbsoluteHours} onChange={(e) => set({ sessionAbsoluteHours: Number(e.target.value) })} />
          </Field>
          <Field label={t('auth.mfaConfig.stepUp')}>
            <TextInput type="number" min={1} max={60} value={draft.stepUpMaxAgeMinutes} onChange={(e) => set({ stepUpMaxAgeMinutes: Number(e.target.value) })} />
          </Field>
        </fieldset>
        <p className="mt-2 text-xs text-muted-foreground">{t('auth.mfaConfig.stepUpHelp')}</p>
        {c && draft.source === 'environment' && (
          <p className="mt-1 text-xs text-muted-foreground">{t('auth.mfaConfig.defaultFromEnv', { value: `${c.sessionDefaults.idleMinutes} min / ${c.sessionDefaults.absoluteHours} h / ${c.sessionDefaults.stepUpMaxAgeMinutes} min` })}</p>
        )}
      </Section>

      {c && (
        <Section title={t('auth.mfaConfig.fixedTitle')} icon={<ShieldCheck size={16} aria-hidden />}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t('auth.mfaConfig.challengeTtl', { seconds: c.challenge.preAuthTtlSeconds, attempts: c.challenge.maxAttempts })}</li>
            <li>{t('auth.mfaConfig.passwordPolicy', { min: c.passwords.minLength, breached: c.passwords.breachedCheck ? t('auth.mfaConfig.breached') : '' })}</li>
          </ul>
        </Section>
      )}

      {!readOnly && (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-background/95 py-3">
          {dirty && <span className="text-xs text-muted-foreground" role="status">{t('auth.mfaConfig.unsaved')}</span>}
          <Button type="button" variant="secondary" disabled={!dirty} onClick={() => { setDraft(saved!); setError(null); }}>{t('auth.cancel')}</Button>
          <Button type="submit" disabled={!dirty || save.isPending}>{t('auth.mfaConfig.save')}</Button>
        </div>
      )}
    </form>
  );
}
