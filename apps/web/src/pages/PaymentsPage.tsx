import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Column, ListPage } from '../components/ListPage';
import { FinanceNav } from '../components/FinanceNav';
import {
  Button,
  Dialog,
  Field,
  SelectInput,
  TextInput,
  useToast,
} from '../components/ui';

interface Payment {
  id: string;
  paymentDate: string;
  amount: string;
  direction: 'IN' | 'OUT';
  reference: string | null;
  counterparty: string | null;
  bankAccount: { id: string; name: string };
  allocations: {
    id: string;
    amount: string;
    invoice: { id: string; invoiceNumber: string; partner: { name: string } };
  }[];
}

interface BankAccount {
  id: string;
  name: string;
  iban: string;
  balance: number;
}

interface OpenItem {
  id: string;
  invoiceNumber: string;
  partner: { name: string };
  dueDate: string;
  open: number;
}

function RecordPaymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    bankAccountId: '',
    direction: 'IN' as 'IN' | 'OUT',
    paymentDate: today,
    amount: '',
    reference: '',
  });
  // invoiceId → allocation amount ('' = not selected)
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccount[]>('/finance/bank-accounts'),
    enabled: open,
  });

  const { data: openItems } = useQuery({
    queryKey: ['open-items', form.direction],
    queryFn: () =>
      api.get<{ items: OpenItem[] }>(
        `/finance/open-items?direction=${form.direction === 'IN' ? 'OUTGOING' : 'INCOMING'}`,
      ),
    enabled: open,
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      value,
    );

  const allocatedTotal = Object.values(allocations).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const amountNum = Number(form.amount || 0);
  const overallocated = allocatedTotal > amountNum + 0.005;

  const toggleInvoice = (item: OpenItem) =>
    setAllocations((current) => {
      const next = { ...current };
      if (next[item.id] !== undefined) delete next[item.id];
      else next[item.id] = item.open.toFixed(2);
      return next;
    });

  const create = useMutation({
    mutationFn: () =>
      api.post('/finance/payments', {
        bankAccountId: form.bankAccountId,
        paymentDate: form.paymentDate,
        amount: form.amount,
        direction: form.direction,
        reference: form.reference || undefined,
        allocations: Object.entries(allocations).map(([invoiceId, amount]) => ({
          invoiceId,
          amount,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/finance/payments'] });
      void queryClient.invalidateQueries({ queryKey: ['open-items'] });
      void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['/finance/invoices'] });
      toast(t('finance.paymentRecorded'));
      onClose();
      setAllocations({});
      setForm((f) => ({ ...f, amount: '', reference: '' }));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('finance.recordPayment')} width="max-w-2xl">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!overallocated) create.mutate();
        }}
      >
        <div className="grid grid-cols-4 gap-3">
          <Field label={t('finance.bankAccount')} required className="col-span-2">
            <SelectInput
              value={form.bankAccountId}
              onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}
              required
            >
              <option value="">—</option>
              {accounts?.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({money(account.balance)})
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('finance.direction')}>
            <SelectInput
              value={form.direction}
              onChange={(e) => {
                setForm((f) => ({ ...f, direction: e.target.value as 'IN' | 'OUT' }));
                setAllocations({});
              }}
            >
              <option value="IN">{t('finance.moneyIn')}</option>
              <option value="OUT">{t('finance.moneyOut')}</option>
            </SelectInput>
          </Field>
          <Field label={t('finance.invoiceDate')} required>
            <TextInput
              type="date"
              value={form.paymentDate}
              onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
              required
            />
          </Field>
          <Field label={`${t('finance.amount')} (€)`} required className="col-span-2">
            <TextInput
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('finance.reference')} className="col-span-2">
            <TextInput
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('finance.allocateTo')} ({openItems?.items.length ?? 0})
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
            {openItems?.items.length ? (
              openItems.items.map((item) => {
                const selected = allocations[item.id] !== undefined;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
                      selected ? 'bg-accent/60' : 'hover:bg-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleInvoice(item)}
                      className="accent-[hsl(var(--primary))]"
                    />
                    <span className="font-mono text-xs">{item.invoiceNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {item.partner.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('finance.open2')}: {money(item.open)}
                    </span>
                    {selected && (
                      <TextInput
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="!w-28 text-right"
                        value={allocations[item.id]}
                        onChange={(e) =>
                          setAllocations((current) => ({
                            ...current,
                            [item.id]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('common.noResults')}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className={`text-sm ${overallocated ? 'text-destructive' : 'text-muted-foreground'}`}>
            {t('finance.allocated')}:{' '}
            <strong className={overallocated ? '' : 'text-foreground'}>
              {money(allocatedTotal)}
            </strong>{' '}
            / {money(amountNum)}
            {overallocated && ` — ${t('finance.overallocated')}`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                create.isPending || !form.bankAccountId || !form.amount || overallocated
              }
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccount[]>('/finance/bank-accounts'),
  });

  const money = (value: number | string) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      Number(value),
    );
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  const columns: Column<Payment>[] = [
    { header: t('finance.invoiceDate'), render: (p) => fmtDate(p.paymentDate), value: (p) => p.paymentDate, type: 'date' },
    {
      header: t('finance.direction'),
      render: (p) => (
        <span className={p.direction === 'IN' ? 'text-success' : 'text-destructive'}>
          {p.direction === 'IN' ? '↓ ' : '↑ '}
          {t(p.direction === 'IN' ? 'finance.moneyIn' : 'finance.moneyOut')}
        </span>
      ),
    },
    { header: t('finance.bankAccount'), render: (p) => p.bankAccount.name },
    { header: t('finance.reference'), render: (p) => p.reference ?? '—' },
    {
      header: t('finance.allocateTo'),
      render: (p) =>
        p.allocations.length
          ? p.allocations.map((a) => a.invoice.invoiceNumber).join(', ')
          : '—',
    },
    {
      header: t('finance.amount'),
      render: (p) => <span className="font-medium tabular-nums">{money(p.amount)}</span>,
      value: (p) => p.amount == null ? null : Number(p.amount),
      type: 'money',
      bar: true,
      total: 'sum',
      align: 'right',
    },
  ];

  return (
    <>
      <FinanceNav />
      {/* bank account balances */}
      <div className="mb-4 flex flex-wrap gap-3">
        {accounts?.map((account) => (
          <div
            key={account.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
              <Landmark size={15} />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">
                {account.name} · {account.iban.replace(/(.{4})/g, '$1 ').trim()}
              </div>
              <div className="text-lg font-bold tabular-nums">{money(account.balance)}</div>
            </div>
            <RecordActions resource="bankAccounts" id={account.id} label={account.name} />
          </div>
        ))}
      </div>

      <ListPage<Payment>
        title={t('finance.payments')}
        endpoint="/finance/payments"
        columns={columns}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('finance.recordPayment')}
          </Button>
        }
      />
      <RecordPaymentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
