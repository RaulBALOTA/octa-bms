import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Loader2, Plus, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import { FinanceNav } from '../components/FinanceNav';
import { Button, Dialog, Field, SelectInput, TextInput, useToast } from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

type ProviderCode = 'QONTO' | 'ENABLE_BANKING';

interface Capabilities {
  enabled: boolean;
  encryptionReady: boolean;
  providers: { code: ProviderCode; name: string; authKind: 'API_KEY' | 'REDIRECT_CONSENT'; configured: boolean; description: string }[];
}

interface Connection {
  id: string;
  provider: ProviderCode;
  displayName: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'ERROR' | 'REVOKED';
  aspspName: string | null;
  aspspCountry: string | null;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  accounts: { id: string; name: string; iban: string; currencyCode: string; syncedBalance: string | null }[];
}

interface BankLine {
  id: string;
  status: 'BOOKED' | 'PENDING';
  bookingDate: string | null;
  valueDate: string | null;
  amount: string;
  currencyCode: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittanceInfo: string | null;
  bankAccount: { id: string; name: string };
}

interface SyncResult { sync: { accounts: number; imported: number; skippedAccounts: string[] } }

const COUNTRIES = ['DE', 'AT', 'CH', 'FR', 'NL', 'BE', 'LU', 'IT', 'ES', 'PT', 'IE', 'FI', 'SE', 'DK', 'NO', 'PL', 'CZ'];
const RENEW_WARN_DAYS = 14;

function useMoney() {
  const { i18n } = useTranslation();
  return (value: number | string, currency = 'EUR') =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(Number(value));
}

function ConnectDialog({ open, onClose, caps }: { open: boolean; onClose: () => void; caps: Capabilities }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<ProviderCode>('QONTO');
  const [form, setForm] = useState({ displayName: 'Qonto', login: '', secretKey: '', country: 'DE', aspspName: '' });
  const info = caps.providers.find((p) => p.code === provider);

  const institutions = useQuery({
    queryKey: ['bank-institutions', form.country],
    queryFn: () => api.get<{ name: string; country: string }[]>(`/finance/banking/institutions?provider=ENABLE_BANKING&country=${form.country}`),
    enabled: open && provider === 'ENABLE_BANKING' && !!info?.configured,
    staleTime: 3_600_000,
  });

  const connect = useMutation({
    mutationFn: async () => {
      if (provider === 'QONTO') {
        return api.post<SyncResult>('/finance/banking/connections', {
          provider, displayName: form.displayName, login: form.login, secretKey: form.secretKey,
        });
      }
      const res = await api.post<{ redirectUrl: string }>('/finance/banking/consents', {
        provider, aspspName: form.aspspName, aspspCountry: form.country, displayName: form.displayName || undefined,
      });
      window.location.assign(res.redirectUrl); // approve read-only access at the bank
      return null;
    },
    onSuccess: (res) => {
      if (!res) return;
      void queryClient.invalidateQueries({ queryKey: ['bank-connections'] });
      void queryClient.invalidateQueries({ queryKey: ['/finance/banking/transactions'] });
      toast(t('banking.synced', { accounts: res.sync.accounts, lines: res.sync.imported }));
      setForm((f) => ({ ...f, login: '', secretKey: '' }));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); connect.mutate(); };

  return (
    <Dialog open={open} onClose={onClose} title={t('banking.connect')}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('banking.provider')} required>
          <SelectInput
            value={provider}
            onChange={(e) => {
              const next = e.target.value as ProviderCode;
              setProvider(next);
              setForm((f) => ({ ...f, displayName: next === 'QONTO' ? 'Qonto' : '' }));
            }}
          >
            {caps.providers.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.configured}>
                {t(`banking.providers.${p.code}.name`)}{p.configured ? '' : ` (${t('banking.notConfigured')})`}
              </option>
            ))}
          </SelectInput>
        </Field>
        {info && <p className="text-xs text-muted-foreground">{t(`banking.providers.${info.code}.description`)}</p>}

        <Field label={t('banking.displayName')} required={provider === 'QONTO'}>
          <TextInput value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required={provider === 'QONTO'} />
        </Field>

        {provider === 'QONTO' ? (
          <>
            <Field label={t('banking.qontoLogin')} required>
              <TextInput value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} autoComplete="off" required />
            </Field>
            <Field label={t('banking.qontoSecret')} required>
              <TextInput type="password" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} autoComplete="new-password" required />
            </Field>
            <p className="text-xs text-muted-foreground">{t('banking.qontoHint')}</p>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('banking.country')} required>
              <SelectInput value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value, aspspName: '' })}>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectInput>
            </Field>
            <Field label={t('banking.bank')} required className="col-span-2">
              <SelectInput value={form.aspspName} onChange={(e) => setForm({ ...form, aspspName: e.target.value })} required>
                <option value="">{institutions.isLoading ? t('common.loading') : '—'}</option>
                {institutions.data?.map((bank) => <option key={bank.name} value={bank.name}>{bank.name}</option>)}
              </SelectInput>
            </Field>
            <p className="col-span-3 text-xs text-muted-foreground">{t('banking.consentHint')}</p>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
          <ShieldCheck size={14} className="shrink-0 text-success" />
          {t('banking.readOnlyNote')}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={connect.isPending || !info?.configured}>
            {connect.isPending && <Loader2 size={14} className="animate-spin" />}
            {provider === 'QONTO' ? t('banking.connectAndSync') : t('banking.continueToBank')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const money = useMoney();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-connections'] });
    void queryClient.invalidateQueries({ queryKey: ['/finance/banking/transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
  };

  const sync = useMutation({
    mutationFn: () => api.post<SyncResult['sync']>(`/finance/banking/connections/${connection.id}/sync`),
    onSuccess: (res) => { refresh(); toast(t('banking.synced', { accounts: res.accounts, lines: res.imported })); },
    onError: (err: Error) => { refresh(); toast(err.message, 'error'); },
  });
  const renew = useMutation({
    mutationFn: () => api.post<{ redirectUrl: string }>('/finance/banking/consents', {
      provider: connection.provider, connectionId: connection.id, aspspName: connection.aspspName, aspspCountry: connection.aspspCountry,
    }),
    onSuccess: (res) => window.location.assign(res.redirectUrl),
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete(`/finance/banking/connections/${connection.id}`),
    onSuccess: () => { refresh(); toast(t('banking.disconnected')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const date = (value: string | null) => (value ? new Date(value).toLocaleString(i18n.language) : '—');
  const expiresInDays = connection.consentExpiresAt
    ? Math.floor((new Date(connection.consentExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const canRenew = connection.provider === 'ENABLE_BANKING' &&
    (connection.status === 'EXPIRED' || (expiresInDays !== null && expiresInDays <= RENEW_WARN_DAYS));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Landmark size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">{connection.displayName}</h2>
        <StatusBadge value={connection.status} />
        <span className="text-xs text-muted-foreground">
          {connection.provider === 'QONTO' ? 'Qonto API' : `PSD2 · ${connection.aspspName ?? ''} (${connection.aspspCountry ?? ''})`}
        </span>
        <div className="flex-1" />
        {hasPermission(me, 'finance.banking.update') && connection.status !== 'PENDING' && (
          <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw size={12} className={sync.isPending ? 'animate-spin' : ''} /> {t('banking.syncNow')}
          </Button>
        )}
        {hasPermission(me, 'finance.banking.create') && canRenew && (
          <Button size="sm" onClick={() => renew.mutate()} disabled={renew.isPending}>{t('banking.renew')}</Button>
        )}
        {hasPermission(me, 'finance.banking.delete') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.confirm(t('banking.confirmDisconnect')) && disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            <Unplug size={12} /> {t('banking.disconnect')}
          </Button>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <span>{t('banking.lastSync')}: <strong className="text-foreground">{date(connection.lastSyncAt)}</strong></span>
        {connection.consentExpiresAt && (
          <span>
            {t('banking.consentUntil')}:{' '}
            <strong className={expiresInDays !== null && expiresInDays <= RENEW_WARN_DAYS ? 'text-warning' : 'text-foreground'}>
              {new Date(connection.consentExpiresAt).toLocaleDateString(i18n.language)}
            </strong>
          </span>
        )}
        <span>{t('banking.access')}: <strong className="text-foreground">{t('banking.readOnly')}</strong></span>
      </div>
      {connection.lastError && connection.status !== 'ACTIVE' && (
        <p role="alert" className="mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{connection.lastError}</p>
      )}

      {connection.accounts.length > 0 && (
        <table className="w-full text-sm">
          <tbody>
            {connection.accounts.map((account) => (
              <tr key={account.id} className="border-t border-border">
                <td className="py-1.5">{account.name}</td>
                <td className="py-1.5 font-mono text-xs text-muted-foreground">{account.iban}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {account.syncedBalance !== null ? money(account.syncedBalance, account.currencyCode) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function BankingPage() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const me = useAuthStore((s) => s.me);
  const companyId = useAuthStore((s) => s.companyId);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  useEffect(() => setAccountId(''), [companyId]);

  const caps = useQuery({ queryKey: ['bank-capabilities'], queryFn: () => api.get<Capabilities>('/finance/banking/capabilities') });
  const ready = !!caps.data?.enabled && caps.data.encryptionReady;
  const connections = useQuery({
    queryKey: ['bank-connections', companyId],
    queryFn: () => api.get<Connection[]>('/finance/banking/connections'),
    enabled: ready,
  });
  const accounts = (connections.data ?? []).flatMap((c) => c.accounts);

  const columns: Column<BankLine>[] = [
    { header: t('banking.bookingDate'), render: (r) => (r.bookingDate ?? r.valueDate) ? new Date((r.bookingDate ?? r.valueDate)!).toLocaleDateString(i18n.language) : '—' },
    { header: t('banking.counterparty'), render: (r) => (
      <div>
        <div className="font-medium">{r.counterpartyName ?? '—'}</div>
        {r.counterpartyIban && <div className="font-mono text-[11px] text-muted-foreground">{r.counterpartyIban}</div>}
      </div>
    ) },
    { header: t('banking.remittance'), render: (r) => <span className="line-clamp-2 text-xs text-muted-foreground">{r.remittanceInfo ?? ''}</span> },
    { header: t('banking.account'), render: (r) => r.bankAccount.name },
    { header: t('common.status'), render: (r) => r.status === 'PENDING' ? <StatusBadge value="PENDING" /> : null },
    { header: t('banking.amount'), align: 'right', render: (r) => (
      <span className={`font-medium tabular-nums ${Number(r.amount) < 0 ? 'text-destructive' : 'text-success'}`}>
        {money(r.amount, r.currencyCode)}
      </span>
    ) },
  ];

  return (
    <>
      <FinanceNav />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{t('banking.title')}</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
          <ShieldCheck size={12} /> {t('banking.readOnly')}
        </span>
        <div className="flex-1" />
        {ready && hasPermission(me, 'finance.banking.create') && (
          <Button onClick={() => setConnectOpen(true)}><Plus size={14} /> {t('banking.connect')}</Button>
        )}
      </div>

      {caps.error && <p role="alert" className="mb-3 text-sm text-destructive">{caps.error.message}</p>}
      {caps.data && !ready && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5 text-sm">
          <p className="mb-1 font-semibold">{t('banking.disabledTitle')}</p>
          <p className="text-muted-foreground">{t('banking.disabledHint')}</p>
        </div>
      )}

      {ready && (
        <>
          <div className="mb-6 grid gap-3 lg:grid-cols-2">
            {connections.data?.map((c) => <ConnectionCard key={c.id} connection={c} />)}
            {connections.data?.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground lg:col-span-2">
                {t('banking.empty')}
              </div>
            )}
          </div>
          <ListPage<BankLine>
            title={t('banking.transactions')}
            endpoint="/finance/banking/transactions"
            extraQuery={accountId ? `bankAccountId=${accountId}` : ''}
            filters={
              <SelectInput value={accountId} onChange={(e) => setAccountId(e.target.value)} className="!w-auto">
                <option value="">{t('banking.allAccounts')}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectInput>
            }
            columns={columns}
          />
          {caps.data && <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} caps={caps.data} />}
        </>
      )}
    </>
  );
}

/**
 * Return route after the user approved (or declined) the PSD2 consent at the
 * bank. The one-time code is handed to the API together with the state that
 * ties it to the pending connection, then scrubbed from browser history.
 */
export function BankingCallbackPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return; // StrictMode double-invoke: the code is single-use
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error_description') ?? params.get('error');
    window.history.replaceState(null, '', '/finance/banking/callback');

    if (!code || !state) {
      toast(error ?? t('banking.consentDeclined'), 'error');
      navigate('/finance/banking', { replace: true });
      return;
    }
    api
      .post<SyncResult>('/finance/banking/consents/complete', { code, state })
      .then((res) => toast(t('banking.synced', { accounts: res.sync.accounts, lines: res.sync.imported })))
      .catch((err: Error) => toast(err.message, 'error'))
      .finally(() => navigate('/finance/banking', { replace: true }));
  }, [navigate, t, toast]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" />
      {t('banking.completing')}
    </div>
  );
}
