import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, SelectInput, Tabs, TextArea, TextInput, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

type Mode = 'DISABLED' | 'OPTIONAL' | 'ENROLLMENT_REQUIRED' | 'ENFORCED';
interface Policy { mfaMode: Mode; enrollmentDeadline: string | null; passkeysEnabled: boolean; requirePasskeyForAdmins: boolean }
interface Overview { users: number; enrolled: number; notEnrolled: number; pendingEnrollments: number; activeSessions: number; pendingRecovery: number; enrolledAdmins: number; policy: Policy }
interface UserRow { id: string; email: string; displayName: string | null; isActive: boolean; isSystemAdmin: boolean; lastLoginAt: string | null; mfaRequired: boolean; mfaEnrolled: boolean; totpEnrolled: boolean; passkeys: number; recoveryCodesRemaining: number; activeSessions: number }
interface RecoveryRow { id: string; status: string; reason: string; verificationMethod: string; requestedById: string; approvedById: string | null; createdAt: string; expiresAt: string; targetUser: { email: string; isSystemAdmin: boolean } }
interface InvitationRow { id: string; email: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null; company: { name: string } }
interface EventRow { id: string; action: string; outcome: string; actorUserId: string | null; targetUserId: string | null; ipPrefix: string | null; createdAt: string }
interface Role { id: string; code: string; name: string }

/** Organization security dashboard: rollout status, policy, users, recovery, invitations, audit. */
export function AdminSecurityPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const companyId = useAuthStore((s) => s.companyId);
  const fmt = (v?: string | null) => (v ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—');
  const [tab, setTab] = useState('users');
  const onError = (e: ApiError) => toast(e.message, 'error');
  const invalidate = () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('sec-') });

  const overview = useQuery({ queryKey: ['sec-overview', companyId], queryFn: () => api.get<Overview>('/admin/security/overview') });
  const users = useQuery({ queryKey: ['sec-users', companyId], queryFn: () => api.get<UserRow[]>('/admin/security/users') });
  const recovery = useQuery({ queryKey: ['sec-recovery', companyId], queryFn: () => api.get<RecoveryRow[]>('/admin/security/recovery-requests'), enabled: tab === 'recovery' });
  const invitations = useQuery({ queryKey: ['sec-invitations', companyId], queryFn: () => api.get<InvitationRow[]>('/admin/security/invitations'), enabled: tab === 'invitations' });
  const events = useQuery({ queryKey: ['sec-events', companyId], queryFn: () => api.get<EventRow[]>('/admin/security/events?take=200'), enabled: tab === 'events' });
  const roles = useQuery({ queryKey: ['sec-roles'], queryFn: () => api.get<Role[]>('/identity/roles'), enabled: tab === 'invitations' });

  const setPilot = useMutation({ mutationFn: (u: UserRow) => api.patch(`/admin/security/users/${u.id}/mfa-required`, { required: !u.mfaRequired }), onSuccess: invalidate, onError });
  const revokeSessions = useMutation({ mutationFn: (id: string) => api.post(`/admin/security/users/${id}/revoke-sessions`), onSuccess: invalidate, onError });
  const recoveryAction = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'complete' }) => api.post(`/admin/security/recovery-requests/${id}/${action}`), onSuccess: invalidate, onError });

  const [recoveryTarget, setRecoveryTarget] = useState<UserRow | null>(null);
  const [recoveryForm, setRecoveryForm] = useState({ reason: '', verificationMethod: '' });
  const createRecovery = useMutation({
    mutationFn: () => api.post('/admin/security/recovery-requests', { targetUserId: recoveryTarget!.id, ...recoveryForm }),
    onSuccess: () => { setRecoveryTarget(null); setRecoveryForm({ reason: '', verificationMethod: '' }); setTab('recovery'); invalidate(); },
    onError,
  });

  const [invite, setInvite] = useState({ email: '', roleId: '' });
  const sendInvite = useMutation({
    mutationFn: () => api.post<{ emailDelivered: boolean }>('/admin/security/invitations', { email: invite.email, companyId, ...(invite.roleId ? { roleId: invite.roleId } : {}) }),
    onSuccess: (r) => { toast(r.emailDelivered ? t('auth.admin.inviteSent') : t('auth.admin.inviteNotSent'), r.emailDelivered ? 'success' : 'error'); setInvite({ email: '', roleId: '' }); invalidate(); },
    onError,
  });
  const revokeInvite = useMutation({ mutationFn: (id: string) => api.post(`/admin/security/invitations/${id}/revoke`), onSuccess: invalidate, onError });

  const o = overview.data;
  const tiles: [string, number | undefined][] = [
    ['users', o?.users], ['enrolled', o?.enrolled], ['notEnrolled', o?.notEnrolled], ['pending', o?.pendingEnrollments],
    ['sessions', o?.activeSessions], ['recoveryRequests', o?.pendingRecovery], ['enrolledAdmins', o?.enrolledAdmins],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={20} aria-hidden />{t('auth.admin.title')}</h1>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([key, value]) => (
          <div key={key} className="rounded-lg border border-border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(`auth.admin.${key}`)}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {o && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4" aria-labelledby="policy-title">
          <div className="flex-1">
            <h2 id="policy-title" className="text-sm font-semibold">{t('auth.admin.policy')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('auth.admin.mode')}: <strong>{t(`auth.admin.modes.${o.policy.mfaMode}`)}</strong>
              {o.policy.enrollmentDeadline && <> · {t('auth.admin.deadline')}: {fmt(o.policy.enrollmentDeadline)}</>}
              {' · '}{t('auth.mfaConfig.passkeysTitle')}: {o.policy.requirePasskeyForAdmins ? t('auth.mfaConfig.requirePasskeys') : o.policy.passkeysEnabled ? '✓' : '—'}
            </p>
          </div>
          <Link to="/admin/security/mfa" className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90">{t('auth.mfaConfig.link')}</Link>
        </section>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'users', label: t('auth.admin.users') },
          { key: 'recovery', label: t('auth.admin.recoveryRequests') },
          { key: 'invitations', label: t('auth.admin.invitations') },
          { key: 'events', label: t('auth.admin.events') },
        ]}
      />

      {tab === 'users' && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>{['user', 'status', 'mfa', 'codes', 'sessions', 'lastLogin', 'actions'].map((h) => <th key={h} className="px-3 py-2 font-medium">{t(`auth.admin.${h}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2"><p className="font-medium">{u.displayName ?? u.email}</p><p className="text-xs text-muted-foreground">{u.email}{u.isSystemAdmin ? ' · admin' : ''}</p></td>
                  <td className="px-3 py-2">{u.isActive ? '●' : '○'}</td>
                  <td className="px-3 py-2">{u.mfaEnrolled ? <>{t('auth.admin.enrolled')}{u.passkeys > 0 && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{t('auth.admin.passkeys')}: {u.passkeys}</span>}</> : <span className="text-amber-700 dark:text-amber-400">{t('auth.admin.notEnrolled')}</span>}{u.mfaRequired && <span className="ml-1 text-xs text-muted-foreground">(pilot)</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{u.mfaEnrolled ? u.recoveryCodesRemaining : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{u.activeSessions}</td>
                  <td className="px-3 py-2 text-xs">{fmt(u.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setPilot.mutate(u)} aria-pressed={u.mfaRequired}>{t('auth.admin.pilot')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => revokeSessions.mutate(u.id)} disabled={!u.activeSessions}>{t('auth.admin.revokeSessions')}</Button>
                      {u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => setRecoveryTarget(u)}>{t('auth.admin.requestRecovery')}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'recovery' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('auth.admin.dualControl')}</p>
          {!recovery.data?.length && <p className="text-sm text-muted-foreground">{t('auth.admin.none')}</p>}
          {recovery.data?.map((r) => (
            <article key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.targetUser.email} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{r.status}</span></p>
                <div className="flex gap-1">
                  {r.status === 'PENDING' && r.requestedById !== me?.id && <Button size="sm" onClick={() => recoveryAction.mutate({ id: r.id, action: 'approve' })}>{t('auth.admin.approve')}</Button>}
                  {r.status === 'APPROVED' && <Button size="sm" variant="destructive" onClick={() => recoveryAction.mutate({ id: r.id, action: 'complete' })}>{t('auth.admin.complete')}</Button>}
                  {['PENDING', 'APPROVED'].includes(r.status) && <Button size="sm" variant="secondary" onClick={() => recoveryAction.mutate({ id: r.id, action: 'reject' })}>{t('auth.admin.reject')}</Button>}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('auth.admin.requestedBy')} {fmt(r.createdAt)} · {t('auth.admin.expires')} {fmt(r.expiresAt)}</p>
              <p className="mt-1">{r.reason}</p>
              <p className="text-xs text-muted-foreground">{r.verificationMethod}</p>
            </article>
          ))}
        </div>
      )}

      {tab === 'invitations' && (
        <div className="space-y-3">
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3" onSubmit={(e: FormEvent) => { e.preventDefault(); sendInvite.mutate(); }}>
            <Field label={t('auth.admin.inviteEmail')} className="min-w-[14rem] flex-1"><TextInput type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
            <Field label={t('auth.admin.role')}>
              <SelectInput value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })}>
                <option value="">—</option>
                {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectInput>
            </Field>
            <Button type="submit" disabled={sendInvite.isPending || !companyId}>{t('auth.admin.invite')}</Button>
          </form>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {invitations.data?.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div><p className="font-medium">{i.email}</p><p className="text-xs text-muted-foreground">{i.company.name} · {i.redeemedAt ? `${t('auth.admin.redeemed')} ${fmt(i.redeemedAt)}` : i.revokedAt ? t('auth.admin.revoked') : `${t('auth.admin.expires')} ${fmt(i.expiresAt)}`}</p></div>
                {!i.redeemedAt && !i.revokedAt && <Button size="sm" variant="ghost" onClick={() => revokeInvite.mutate(i.id)}>{t('auth.admin.revokeInvite')}</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'events' && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">{t('auth.admin.when')}</th><th className="px-3 py-2 font-medium">{t('auth.admin.action')}</th><th className="px-3 py-2 font-medium">{t('auth.admin.outcome')}</th><th className="px-3 py-2 font-medium">IP</th></tr></thead>
            <tbody className="divide-y divide-border">
              {events.data?.map((e) => (
                <tr key={e.id}><td className="px-3 py-1.5 text-xs">{fmt(e.createdAt)}</td><td className="px-3 py-1.5 font-mono text-xs">{e.action}</td><td className={e.outcome === 'success' ? 'px-3' : 'px-3 text-destructive'}>{e.outcome}</td><td className="px-3 text-xs text-muted-foreground">{e.ipPrefix ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!recoveryTarget} title={`${t('auth.admin.requestRecovery')}: ${recoveryTarget?.email ?? ''}`} onClose={() => setRecoveryTarget(null)}>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); createRecovery.mutate(); }} className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('auth.admin.dualControl')}</p>
          <Field label={t('auth.admin.reason')} required><TextArea required minLength={10} maxLength={500} value={recoveryForm.reason} onChange={(e) => setRecoveryForm({ ...recoveryForm, reason: e.target.value })} /></Field>
          <Field label={t('auth.admin.verification')} required><TextInput required minLength={5} maxLength={300} value={recoveryForm.verificationMethod} onChange={(e) => setRecoveryForm({ ...recoveryForm, verificationMethod: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRecoveryTarget(null)}>{t('auth.cancel')}</Button>
            <Button type="submit" disabled={createRecovery.isPending}>{t('auth.admin.requestRecovery')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
