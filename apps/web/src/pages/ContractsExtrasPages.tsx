import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, RefreshCw, Shield, Umbrella } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { ContractsNav } from '../components/ContractsNav';
import { StatusBadge } from '../components/ListPage';
import {
  Button,
  Dialog,
  Field,
  SelectInput,
  Skeleton,
  TextInput,
  useToast,
} from '../components/ui';
import { ContractDrawer } from './ContractsPage';

/* ----------------------------------------------------- bank guarantees */

interface Guarantee {
  id: string;
  guaranteeNumber: string;
  type: string;
  issuingBank: string;
  amount: string;
  expiryDate: string | null;
  status: string;
  contract?: { id: string; contractNumber: string; title: string } | null;
}

const GUARANTEE_TYPES = ['ADVANCE_PAYMENT', 'PERFORMANCE', 'WARRANTY', 'BID_BOND'];

export function GuaranteesPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    guaranteeNumber: '',
    type: 'PERFORMANCE',
    issuingBank: '',
    amount: '',
    expiryDate: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: guarantees, isLoading } = useQuery({
    queryKey: ['guarantees'],
    queryFn: () => api.get<Guarantee[]>('/contracts/guarantees'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/contracts/guarantees', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['guarantees'] });
      toast(t('common.created'));
      setCreateOpen(false);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/contracts/guarantees/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['guarantees'] });
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: string) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      Number(value),
    );
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const totalActive =
    guarantees
      ?.filter((g) => g.status === 'ACTIVE')
      .reduce((sum, g) => sum + Number(g.amount), 0) ?? 0;

  return (
    <>
      <ContractsNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('contracts.guarantees')}</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {t('contracts.activeExposure')}: <strong>{money(String(totalActive))}</strong>
        </span>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          {t('common.new')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : guarantees?.length ? (
        <ul className="space-y-2">
          {guarantees.map((guarantee) => (
            <li
              key={guarantee.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Shield size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {guarantee.guaranteeNumber}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t(`contracts.guaranteeType.${guarantee.type}`)} · {guarantee.issuingBank}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {guarantee.contract
                    ? `${guarantee.contract.contractNumber} · ${guarantee.contract.title}`
                    : '—'}{' '}
                  · {t('contracts.expiry')}: {fmtDate(guarantee.expiryDate)}
                </div>
              </div>
              <span className="font-semibold tabular-nums">{money(guarantee.amount)}</span>
              <StatusBadge value={guarantee.status} />
              <RecordActions resource="guarantees" id={guarantee.id} label={guarantee.guaranteeNumber} />
              {guarantee.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatus.mutate({ id: guarantee.id, status: 'RETURNED' })}
                >
                  {t('contracts.markReturned')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('contracts.newGuarantee')}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('crm.number')} required>
              <TextInput
                value={form.guaranteeNumber}
                onChange={set('guaranteeNumber')}
                required
                autoFocus
              />
            </Field>
            <Field label={t('crm.type')}>
              <SelectInput value={form.type} onChange={set('type')}>
                {GUARANTEE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`contracts.guaranteeType.${type}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t('contracts.issuingBank')} required>
              <TextInput value={form.issuingBank} onChange={set('issuingBank')} required />
            </Field>
            <Field label={`${t('finance.amount')} (€)`} required>
              <TextInput
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={set('amount')}
                required
              />
            </Field>
            <Field label={t('contracts.expiry')}>
              <TextInput type="date" value={form.expiryDate} onChange={set('expiryDate')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !form.guaranteeNumber || !form.issuingBank || !form.amount}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* --------------------------------------------------------- insurance */

interface Insurance {
  id: string;
  policyNumber: string;
  type: string;
  insurer: string;
  coverageAmount: string | null;
  annualPremium: string | null;
  endDate: string | null;
}

const INSURANCE_TYPES = [
  'PROFESSIONAL_LIABILITY', 'PUBLIC_LIABILITY', 'D_AND_O', 'CYBER', 'PROPERTY', 'VEHICLE',
];

export function InsurancePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    policyNumber: '',
    type: 'PROFESSIONAL_LIABILITY',
    insurer: '',
    coverageAmount: '',
    annualPremium: '',
    endDate: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: policies, isLoading } = useQuery({
    queryKey: ['insurance'],
    queryFn: () => api.get<Insurance[]>('/contracts/insurance'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/contracts/insurance', {
        ...form,
        coverageAmount: form.coverageAmount || undefined,
        annualPremium: form.annualPremium || undefined,
        endDate: form.endDate || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['insurance'] });
      toast(t('common.created'));
      setCreateOpen(false);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: string | null) =>
    value
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(Number(value))
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  return (
    <>
      <ContractsNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('contracts.insurance')}</h1>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          {t('common.new')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : policies?.length ? (
        <ul className="space-y-2">
          {policies.map((policy) => (
            <li
              key={policy.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Umbrella size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t(`contracts.insuranceType.${policy.type}`)}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {policy.policyNumber}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {policy.insurer} · {t('contracts.coverage')}: {money(policy.coverageAmount)} ·{' '}
                  {t('contracts.premium')}: {money(policy.annualPremium)}/a
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {t('contracts.expiry')}: {fmtDate(policy.endDate)}
              </span>
              <RecordActions resource="insurance" id={policy.id} label={policy.policyNumber} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('contracts.newInsurance')}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('crm.number')} required>
              <TextInput value={form.policyNumber} onChange={set('policyNumber')} required autoFocus />
            </Field>
            <Field label={t('crm.type')}>
              <SelectInput value={form.type} onChange={set('type')}>
                {INSURANCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`contracts.insuranceType.${type}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t('contracts.insurer')} required>
              <TextInput value={form.insurer} onChange={set('insurer')} required />
            </Field>
            <Field label={`${t('contracts.coverage')} (€)`}>
              <TextInput type="number" min="0" value={form.coverageAmount} onChange={set('coverageAmount')} />
            </Field>
            <Field label={`${t('contracts.premium')} (€/a)`}>
              <TextInput type="number" min="0" value={form.annualPremium} onChange={set('annualPremium')} />
            </Field>
            <Field label={t('contracts.expiry')}>
              <TextInput type="date" value={form.endDate} onChange={set('endDate')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !form.policyNumber || !form.insurer}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------ expiry monitor */

interface ExpiringContract {
  id: string;
  contractNumber: string;
  title: string;
  endDate: string | null;
  noticePeriodDays: number | null;
  autoRenewal: boolean;
  partner?: { name: string } | null;
}

export function ExpiryPage() {
  const { t, i18n } = useTranslation();
  const [horizon, setHorizon] = useState('180');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['expiring', horizon],
    queryFn: () =>
      api.get<ExpiringContract[]>(`/contracts/expiring?withinDays=${horizon}`),
  });

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';
  const daysLeft = (iso: string | null) =>
    iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <>
      <ContractsNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('contracts.expiryMonitor')}</h1>
        <div className="flex-1" />
        <SelectInput
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          className="!w-auto"
        >
          <option value="90">90 {t('leave.days')}</option>
          <option value="180">180 {t('leave.days')}</option>
          <option value="365">365 {t('leave.days')}</option>
        </SelectInput>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : contracts?.length ? (
        <ul className="space-y-2">
          {contracts.map((contract) => {
            const remaining = daysLeft(contract.endDate);
            const urgent = remaining !== null && remaining <= 30;
            return (
              <li key={contract.id}>
                <button
                  onClick={() => setSelectedId(contract.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                >
                  <span
                    className={clsx(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      urgent ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning',
                    )}
                  >
                    <CalendarClock size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      <span className="font-mono text-xs">{contract.contractNumber}</span>{' '}
                      {contract.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {contract.partner?.name}
                      {contract.noticePeriodDays
                        ? ` · ${t('contracts.noticePeriod')}: ${contract.noticePeriodDays} ${t('leave.days')}`
                        : ''}
                      {contract.autoRenewal && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                          <RefreshCw size={10} />
                          {t('contracts.autoRenewal')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={clsx(
                        'text-sm font-bold tabular-nums',
                        urgent ? 'text-destructive' : 'text-warning',
                      )}
                    >
                      {remaining} {t('leave.days')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(contract.endDate)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('contracts.noneExpiring')}
        </p>
      )}

      {selectedId && (
        <ContractDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
