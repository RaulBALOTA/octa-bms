import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, Paged } from '../lib/api';
import {
  Avatar,
  Button,
  Dialog,
  Field,
  SelectInput,
  Skeleton,
  TextInput,
  useToast,
} from '../components/ui';
import { useAuthStore } from '../stores/auth';
import { RecordActions, RecordCreateButton } from '../components/RecordActions';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isSystemAdmin: boolean;
  lastLoginAt: string | null;
}

interface Role {
  id: string;
  code: string;
  name: string;
  permissions: { permission: { code: string } }[];
  _count: { userRoles: number };
}

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () => api.post('/identity/users', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('admin.newUser')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('auth.email')} required>
          <TextInput type="email" value={form.email} onChange={set('email')} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.firstName')} required>
            <TextInput value={form.firstName} onChange={set('firstName')} required />
          </Field>
          <Field label={t('hr.lastName')} required>
            <TextInput value={form.lastName} onChange={set('lastName')} required />
          </Field>
        </div>
        <Field label={t('auth.password')} required>
          <TextInput
            type="password"
            value={form.password}
            onChange={set('password')}
            minLength={12}
            required
            placeholder={t('admin.passwordHint')}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AdminPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((s) => s.companyId);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<Paged<UserRow>>('/identity/users?pageSize=100'),
  });
  const { data: roles } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get<Role[]>('/identity/roles'),
  });

  const { data: integrations } = useQuery({
    queryKey: ['integrations'],
    queryFn: () =>
      api.get<Record<string, boolean>>('/communication/integrations'),
  });

  const reindex = useMutation({
    mutationFn: () => api.post<{ counts: Record<string, number> }>('/search/reindex'),
    onSuccess: (result) => {
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
      toast(`${t('admin.reindexed')}: ${total}`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const testTeams = useMutation({
    mutationFn: () => api.post('/communication/integrations/test-teams'),
    onSuccess: () => toast(t('admin.teamsTested')),
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const assign = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.post('/identity/roles/assign', { userId, roleId, companyId }),
    onSuccess: () => {
      toast(t('admin.roleAssigned'));
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(iso))
      : '—';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('nav.admin')}</h1>
        <div className="flex-1" />
        <Link to="/admin/security" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted">
          <ShieldCheck size={14} />
          {t('nav.adminSecurity')}
        </Link>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          {t('admin.newUser')}
        </Button>
      </div>

      <section className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t('admin.users')}
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t('crm.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('auth.email')}</th>
                <th className="px-4 py-2.5 font-medium">{t('admin.lastLogin')}</th>
                <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  {t('admin.assignRole')}
                </th>
              </tr>
            </thead>
            <tbody>
              {users?.data.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      <Avatar name={`${user.firstName} ${user.lastName}`} size={22} />
                      {user.firstName} {user.lastName}
                      {user.isSystemAdmin && (
                        <ShieldCheck size={13} className="text-primary" />
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {fmtDate(user.lastLoginAt)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        user.isActive
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {user.isActive ? t('admin.active') : t('admin.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <SelectInput
                      className="!w-44"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          assign.mutate({ userId: user.id, roleId: e.target.value });
                          e.target.value = '';
                        }
                      }}
                    >
                      <option value="">{t('admin.assignRole')}…</option>
                      {roles?.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </SelectInput>
                    <RecordActions resource="users" id={user.id} label={`${user.firstName} ${user.lastName}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
          <Plug size={14} className="text-primary" />
          {t('admin.integrations')}
        </div>
        <ul className="divide-y divide-border">
          {integrations &&
            (
              [
                ['ai', 'AI (Claude API)'],
                ['meilisearch', 'Meilisearch'],
                ['entraSso', 'Azure Entra SSO'],
                ['graphMail', 'Microsoft Graph Mail'],
                ['teamsWebhook', 'Teams Webhook'],
              ] as const
            ).map(([key, label]) => (
              <li key={key} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    integrations[key] ? 'bg-success' : 'bg-muted-foreground/40'
                  }`}
                />
                <span className="flex-1 text-sm">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {integrations[key] ? t('admin.connected') : t('admin.notConfigured')}
                </span>
                {key === 'meilisearch' && integrations[key] && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={reindex.isPending}
                    onClick={() => reindex.mutate()}
                  >
                    <RefreshCw size={12} />
                    {t('admin.reindex')}
                  </Button>
                )}
                {key === 'teamsWebhook' && integrations[key] && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={testTeams.isPending}
                    onClick={() => testTeams.mutate()}
                  >
                    {t('admin.test')}
                  </Button>
                )}
              </li>
            ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t('admin.roles')}
          <RecordCreateButton resource="roles" />
        </div>
        <ul className="divide-y divide-border">
          {roles?.map((role) => (
            <li key={role.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <div className="text-sm font-medium">{role.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{role.code}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {role.permissions.length} {t('admin.permissions')} ·{' '}
                {role._count.userRoles} {t('admin.assignments')}
              </div>
              <RecordActions resource="roles" id={role.id} label={role.name} />
            </li>
          ))}
        </ul>
      </section>

      <NewUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
