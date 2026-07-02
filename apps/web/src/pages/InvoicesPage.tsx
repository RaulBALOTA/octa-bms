import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import {
  Button,
  Dialog,
  Drawer,
  Field,
  KeyValue,
  SelectInput,
  Skeleton,
  TextInput,
  useToast,
} from '../components/ui';

interface Invoice {
  id: string;
  invoiceNumber: string;
  direction: 'OUTGOING' | 'INCOMING';
  status: string;
  invoiceDate: string;
  serviceDate: string | null;
  dueDate: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  paidAmount: string;
  currencyCode: string;
  reference: string | null;
  partner?: { name: string } | null;
}

interface InvoiceDetail extends Invoice {
  lines: {
    id: string;
    position: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    netAmount: string;
    taxCode: { code: string; ratePercent: string };
  }[];
}

const NEXT_STATES: Record<string, string[]> = {
  DRAFT: ['IN_APPROVAL', 'CANCELLED'],
  IN_APPROVAL: ['APPROVED', 'DRAFT'],
  APPROVED: ['SENT'],
  SENT: ['PAID', 'DISPUTED'],
  PARTIALLY_PAID: ['PAID'],
  OVERDUE: ['PAID', 'DISPUTED'],
  DISPUTED: ['SENT', 'PAID', 'CANCELLED'],
};

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: invoice } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetail>(`/finance/invoices/${id}`),
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      api.post(`/finance/invoices/${id}/transition`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      void queryClient.invalidateQueries({ queryKey: ['/finance/invoices'] });
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: string) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: invoice?.currencyCode ?? 'EUR',
    }).format(Number(value));
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  return (
    <Drawer open onClose={onClose} width="w-[640px]">
      {!invoice ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Wallet size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">
                  {invoice.invoiceNumber}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {invoice.partner?.name}
                  </span>
                </h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {t(
                      invoice.direction === 'OUTGOING'
                        ? 'finance.outgoing'
                        : 'finance.incoming',
                    )}
                  </span>
                  <StatusBadge value={invoice.status} />
                </div>
              </div>
            </div>
            {(NEXT_STATES[invoice.status] ?? []).length > 0 && (
              <div className="mt-3 flex gap-2">
                {NEXT_STATES[invoice.status].map((next) => (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === 'CANCELLED' ? 'destructive' : 'secondary'}
                    disabled={transition.isPending}
                    onClick={() => transition.mutate(next)}
                  >
                    → {t(`finance.status.${next}`, next)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="grid grid-cols-3 gap-x-4 gap-y-4">
              <KeyValue label={t('finance.invoiceDate')}>
                {fmtDate(invoice.invoiceDate)}
              </KeyValue>
              <KeyValue label={t('finance.serviceDate')}>
                {fmtDate(invoice.serviceDate)}
              </KeyValue>
              <KeyValue label={t('finance.dueDate')}>{fmtDate(invoice.dueDate)}</KeyValue>
            </dl>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('finance.lines')}
              </h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">{t('finance.description')}</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('finance.qty')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('finance.price')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('finance.net')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((line) => (
                      <tr key={line.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-muted-foreground">{line.position}</td>
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {Number(line.quantity)} {line.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(line.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {money(line.netAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ml-auto w-64 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('finance.net')}</span>
                <span className="tabular-nums">{money(invoice.netAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t('finance.vat')} ({invoice.lines[0]?.taxCode.ratePercent ?? '19'}%)
                </span>
                <span className="tabular-nums">{money(invoice.taxAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>{t('finance.gross')}</span>
                <span className="tabular-nums">{money(invoice.grossAmount)}</span>
              </div>
              {Number(invoice.paidAmount) > 0 && (
                <div className="flex justify-between text-success">
                  <span>{t('finance.paid')}</span>
                  <span className="tabular-nums">{money(invoice.paidAmount)}</span>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

interface TaxCode {
  id: string;
  code: string;
  name: string;
  ratePercent: string;
}

interface LineDraft {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxCodeId: string;
}

function NewInvoiceDialog({
  open,
  onClose,
  direction,
}: {
  open: boolean;
  onClose: () => void;
  direction: string;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const in30days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [head, setHead] = useState({
    partnerId: '',
    invoiceDate: today,
    serviceDate: today,
    dueDate: in30days,
    reference: '',
  });
  const emptyLine = (taxCodeId = ''): LineDraft => ({
    description: '',
    quantity: '1',
    unit: 'h',
    unitPrice: '',
    taxCodeId,
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const { data: partners } = useQuery({
    queryKey: ['partners-for-invoice', direction],
    queryFn: () =>
      api.get<Paged<{ id: string; name: string }>>(
        `/crm/partners?pageSize=200&sort=name${
          direction === 'OUTGOING' ? '&type=CLIENT' : ''
        }`,
      ),
    enabled: open,
  });

  const { data: taxCodes } = useQuery({
    queryKey: ['tax-codes'],
    queryFn: () => api.get<TaxCode[]>('/master/tax-codes'),
    enabled: open,
  });

  const defaultTax = taxCodes?.find((tc) => tc.code === 'DE-19')?.id ?? '';

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  // live client-side totals (server recomputes authoritatively)
  const rateOf = (taxCodeId: string) =>
    Number(taxCodes?.find((tc) => tc.id === taxCodeId)?.ratePercent ?? 0);
  let netCents = 0;
  let taxCents = 0;
  for (const line of lines) {
    const lineNet = Math.round(Number(line.quantity || 0) * Number(line.unitPrice || 0) * 100);
    netCents += lineNet;
    taxCents += Math.round((lineNet * rateOf(line.taxCodeId || defaultTax)) / 100);
  }
  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      cents / 100,
    );

  const valid =
    head.partnerId &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== '');

  const create = useMutation({
    mutationFn: () =>
      api.post<{ invoiceNumber: string }>('/finance/invoices', {
        direction,
        partnerId: head.partnerId,
        invoiceDate: head.invoiceDate,
        serviceDate: head.serviceDate || undefined,
        dueDate: head.dueDate,
        reference: head.reference || undefined,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          taxCodeId: l.taxCodeId || defaultTax,
        })),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['/finance/invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['kpis'] });
      toast(`${created.invoiceNumber} ${t('common.created')}`);
      onClose();
      setHead({ partnerId: '', invoiceDate: today, serviceDate: today, dueDate: in30days, reference: '' });
      setLines([emptyLine()]);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('finance.newInvoice')} width="max-w-3xl">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <div className="grid grid-cols-4 gap-3">
          <Field label={t('contracts.partner')} required className="col-span-2">
            <SelectInput
              value={head.partnerId}
              onChange={(e) => setHead((h) => ({ ...h, partnerId: e.target.value }))}
              required
            >
              <option value="">—</option>
              {partners?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('finance.invoiceDate')} required>
            <TextInput
              type="date"
              value={head.invoiceDate}
              onChange={(e) => setHead((h) => ({ ...h, invoiceDate: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('finance.dueDate')} required>
            <TextInput
              type="date"
              value={head.dueDate}
              onChange={(e) => setHead((h) => ({ ...h, dueDate: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('finance.serviceDate')}>
            <TextInput
              type="date"
              value={head.serviceDate}
              onChange={(e) => setHead((h) => ({ ...h, serviceDate: e.target.value }))}
            />
          </Field>
          <Field label={t('finance.reference')} className="col-span-3">
            <TextInput
              value={head.reference}
              onChange={(e) => setHead((h) => ({ ...h, reference: e.target.value }))}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('finance.lines')}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLines((ls) => [...ls, emptyLine(defaultTax)])}
            >
              <Plus size={13} />
              {t('finance.addLine')}
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 items-center gap-2">
                <TextInput
                  className="col-span-5"
                  placeholder={t('finance.description')}
                  value={line.description}
                  onChange={(e) => setLine(index, { description: e.target.value })}
                  required
                />
                <TextInput
                  className="col-span-1"
                  type="number"
                  min="0"
                  step="0.25"
                  placeholder={t('finance.qty')}
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                />
                <SelectInput
                  className="col-span-1"
                  value={line.unit}
                  onChange={(e) => setLine(index, { unit: e.target.value })}
                >
                  {['h', 'day', 'pcs', 'LS'].map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </SelectInput>
                <TextInput
                  className="col-span-2"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="€"
                  value={line.unitPrice}
                  onChange={(e) => setLine(index, { unitPrice: e.target.value })}
                  required
                />
                <SelectInput
                  className="col-span-2"
                  value={line.taxCodeId || defaultTax}
                  onChange={(e) => setLine(index, { taxCodeId: e.target.value })}
                >
                  {taxCodes?.map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.code}
                    </option>
                  ))}
                </SelectInput>
                <button
                  type="button"
                  className="col-span-1 justify-self-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-30"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                  aria-label={t('finance.removeLine')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-between border-t border-border pt-3">
          <div className="text-sm text-muted-foreground">
            {t('finance.net')}: <strong className="text-foreground">{money(netCents)}</strong>
            <span className="mx-2">·</span>
            {t('finance.vat')}: <strong className="text-foreground">{money(taxCents)}</strong>
            <span className="mx-2">·</span>
            {t('finance.gross')}:{' '}
            <strong className="text-foreground">{money(netCents + taxCents)}</strong>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const [direction, setDirection] = useState('OUTGOING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fmtMoney = (value: string, currency: string) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(
      Number(value),
    );
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  const columns: Column<Invoice>[] = [
    {
      header: t('finance.invoiceNumber'),
      render: (i) => <span className="font-mono text-xs">{i.invoiceNumber}</span>,
    },
    { header: t('contracts.partner'), render: (i) => i.partner?.name ?? '—' },
    { header: t('finance.invoiceDate'), render: (i) => fmtDate(i.invoiceDate) },
    { header: t('finance.dueDate'), render: (i) => fmtDate(i.dueDate) },
    {
      header: t('finance.net'),
      render: (i) => fmtMoney(i.netAmount, i.currencyCode),
      align: 'right',
    },
    {
      header: t('finance.gross'),
      render: (i) => (
        <span className="font-medium">{fmtMoney(i.grossAmount, i.currencyCode)}</span>
      ),
      align: 'right',
    },
    { header: t('common.status'), render: (i) => <StatusBadge value={i.status} /> },
  ];

  return (
    <>
      <ListPage<Invoice>
        title={t('finance.title')}
        endpoint="/finance/invoices"
        columns={columns}
        extraQuery={`direction=${direction}`}
        onRowClick={(i) => setSelectedId(i.id)}
        filters={
          <SelectInput
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="!w-auto"
          >
            <option value="OUTGOING">{t('finance.outgoing')}</option>
            <option value="INCOMING">{t('finance.incoming')}</option>
          </SelectInput>
        }
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      {selectedId && (
        <InvoiceDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <NewInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        direction={direction}
      />
    </>
  );
}
