import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, ShieldAlert, ShieldCheck } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Dialog, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { FormError, OtpInput, PasswordInput, RecoveryCodesPanel } from './auth/components';

interface SessionRow { id: string; issuedAt: string; lastActivityAt: string; authMethod: string; lastMfaAt: string | null; userAgent: string | null; ipPrefix: string | null; current: boolean }
interface EventRow { id: string; action: string; outcome: string; createdAt: string; userAgent: string | null }

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby={`card-${title}`}>
      <h2 id={`card-${title}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

/** Personal security center: factor status, recovery codes, password, sessions, activity. */
export function SecurityPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { me, loadMe } = useAuthStore();
  const fmt = (value?: string | null) => (value ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—');
  const mfa = me?.mfa;

  const sessions = useQuery({ queryKey: ['auth-sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const activity = useQuery({ queryKey: ['auth-activity'], queryFn: () => api.get<EventRow[]>('/auth/security/activity') });
  const refresh = () => { void loadMe(); void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] }); void queryClient.invalidateQueries({ queryKey: ['auth-activity'] }); };

  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const rotate = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/recovery-codes/rotate'),
    onSuccess: (res) => { setNewCodes(res.recoveryCodes); refresh(); },
    onError: (e: ApiError) => toast(e.message, 'error'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`), onSuccess: refresh });
  const logoutOthers = useMutation({ mutationFn: () => api.post('/auth/logout-all'), onSuccess: refresh });

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const disable = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { code: disableCode }),
    onSuccess: () => { setDisableOpen(false); setDisableCode(''); refresh(); },
    onError: (e: ApiError) => toast(e.message, 'error'),
  });

  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/password/change', { currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: () => { setPw({ current: '', next: '' }); setPwError(null); toast(t('auth.security.passwordChanged'), 'success'); refresh(); },
    onError: (e: ApiError) => setPwError(e.message),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">{t('auth.security.title')}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('auth.security.mfaTitle')} icon={mfa?.enrolled ? <ShieldCheck size={16} className="text-green-600" aria-hidden /> : <ShieldAlert size={16} className="text-amber-600" aria-hidden />}>
          <p className="text-sm font-medium">{mfa?.enrolled ? t('auth.security.enabled') : t('auth.security.disabled')}</p>
          {mfa?.required && <p className="text-xs text-muted-foreground">{mfa.enrollmentDue ? t('auth.security.dueBy', { date: fmt(mfa.enrollmentDue) }) : t('auth.security.requiredBy')}</p>}
          {mfa?.enrolled && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('auth.security.enrolledAt', { date: fmt(mfa.enrolledAt) })} · {t('auth.security.lastUsed', { date: fmt(mfa.lastUsedAt) })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/auth/setup-mfa?next=/security" className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              {mfa?.enrolled ? t('auth.security.replace') : t('auth.security.enable')}
            </Link>
            {mfa?.enrolled && !mfa.required && <Button variant="secondary" onClick={() => setDisableOpen(true)}>{t('auth.security.turnOff')}</Button>}
          </div>
          {mfa?.enrolled && <p className="mt-2 text-xs text-muted-foreground">{t('auth.setup.replaceWarning')}</p>}
        </Card>

        <Card title={t('auth.security.recoveryTitle')} icon={<KeyRound size={16} aria-hidden />}>
          {mfa?.enrolled ? (
            <>
              <p className="text-sm">{t('auth.security.recoveryRemaining', { count: mfa.recoveryCodesRemaining })}</p>
              {mfa.recoveryCodesRemaining <= 3 && <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('auth.security.recoveryLow')}</p>}
              <Button className="mt-3" variant="secondary" onClick={() => rotate.mutate()} disabled={rotate.isPending}>{t('auth.security.regenerate')}</Button>
            </>
          ) : <p className="text-sm text-muted-foreground">—</p>}
        </Card>

        <Card title={t('auth.security.passwordTitle')} icon={<KeyRound size={16} aria-hidden />}>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); changePassword.mutate(); }}>
            <FormError message={pwError} />
            <PasswordInput label={t('auth.security.currentPassword')} value={pw.current} onChange={(current) => setPw({ ...pw, current })} />
            <PasswordInput label={t('auth.reset.newPassword')} value={pw.next} onChange={(next) => setPw({ ...pw, next })} autoComplete="new-password" hint={t('auth.passwordHint', { min: 12 })} />
            <Button type="submit" disabled={changePassword.isPending || !pw.current || pw.next.length < 12}>{t('auth.security.changePassword')}</Button>
          </form>
        </Card>

        <Card title={t('auth.security.sessionsTitle')} icon={<Laptop size={16} aria-hidden />}>
          <ul className="divide-y divide-border text-sm">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{s.userAgent ?? '—'} {s.current && <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t('auth.security.current')}</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('auth.security.signedIn', { date: fmt(s.issuedAt) })} · {t('auth.security.lastActive', { date: fmt(s.lastActivityAt) })}
                    {s.ipPrefix && <> · {t('auth.security.approxLocation', { net: s.ipPrefix })}</>}
                  </p>
                </div>
                {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>{t('auth.security.revoke')}</Button>}
              </li>
            ))}
          </ul>
          {(sessions.data?.length ?? 0) > 1 && <Button className="mt-2" size="sm" variant="secondary" onClick={() => logoutOthers.mutate()}>{t('auth.security.logoutOthers')}</Button>}
        </Card>
      </div>

      <Card title={t('auth.security.activityTitle')} icon={<ShieldCheck size={16} aria-hidden />}>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1 font-medium">{t('auth.admin.action')}</th><th className="font-medium">{t('auth.admin.outcome')}</th><th className="font-medium">{t('auth.admin.when')}</th></tr></thead>
          <tbody className="divide-y divide-border">
            {activity.data?.map((e) => (
              <tr key={e.id}><td className="py-1.5 font-mono text-xs">{e.action}</td><td className={e.outcome === 'success' ? '' : 'text-destructive'}>{e.outcome}</td><td className="text-xs text-muted-foreground">{fmt(e.createdAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      {newCodes && (
        <Dialog open title={t('auth.codes.title')} onClose={() => undefined}>
          <RecoveryCodesPanel codes={newCodes} onDone={() => setNewCodes(null)} />
        </Dialog>
      )}
      <Dialog open={disableOpen} title={t('auth.security.turnOff')} onClose={() => setDisableOpen(false)}>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); disable.mutate(); }}>
          <p className="mb-3 text-sm text-muted-foreground">{t('auth.security.turnOffConfirm')}</p>
          <OtpInput value={disableCode} onChange={setDisableCode} label={t('auth.mfa.codeLabel')} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDisableOpen(false)}>{t('auth.cancel')}</Button>
            <Button type="submit" variant="destructive" disabled={disableCode.length !== 6}>{t('auth.security.turnOff')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
