import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer, Sparkles, Trash2, Wallet } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
import { AiSummary } from '../components/ai';
import { printInvoice } from '../lib/print-invoice';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import { FinanceNav } from '../components/FinanceNav';
import { OpenItemsSummary } from '../components/OpenItemsSummary';
import { DaysLeft, Meter } from '../components/infographics';
import { daysUntil } from '../lib/format';
import {
  Button,
  Dialog,
  Drawer,
  Field,
  KeyValue,
  SelectInput,
  Skeleton,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { useAiStatus } from '../components/ai';

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

  const { data: company } = useQuery({
    queryKey: ['company-profile'],
    queryFn: () =>
      api.get<Parameters<typeof printInvoice>[1]>('/master/company-profile'),
    staleTime: 300_000,
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
              {invoice.direction === 'OUTGOING' && company && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    printInvoice(
                      invoice as unknown as Parameters<typeof printInvoice>[0],
                      company,
                      i18n.language,
                    )
                  }
                >
                  <Printer size={13} />
                  {t('finance.print')}
                </Button>
              )}
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
            <AiSummary entityType="invoice" entityId={id} />
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
  budgetCategory: string;
}

interface BudgetCatalog {
  groups: { code: string; type: string; nameDe: string; nameEn: string }[];
  categories: {
    code: string;
    group: string;
    type: string;
    nameDe: string;
    nameEn: string;
  }[];
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
    budgetCategory: '',
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [aiText, setAiText] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const { data: aiStatus } = useAiStatus();

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

  const isIncoming = direction === 'INCOMING';
  const { data: catalog } = useQuery({
    queryKey: ['budget-categories'],
    queryFn: () => api.get<BudgetCatalog>('/finance/budgets/categories'),
    enabled: open && isIncoming,
    staleTime: 300_000,
  });
  const isGerman = i18n.language.startsWith('de');
  const catName = (c: { nameDe: string; nameEn: string }) =>
    isGerman ? c.nameDe : c.nameEn;
  const expenseGroups =
    catalog?.groups
      .filter((g) => g.type === 'EXPENSE')
      .map((g) => ({
        ...g,
        categories: catalog.categories.filter((c) => c.group === g.code),
      })) ?? [];

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

  interface ExtractedInvoice {
    partnerName: string;
    externalNumber: string | null;
    invoiceDate: string;
    serviceDate: string | null;
    dueDate: string;
    lines: {
      description: string;
      quantity: number;
      unit: string;
      unitPrice: number;
      vatRate: number;
    }[];
  }

  const extract = useMutation({
    mutationFn: () =>
      api.post<ExtractedInvoice>('/ai/extract-invoice', { text: aiText }),
    onSuccess: (data) => {
      // match partner by name; tax code by VAT rate
      const partnerMatch = partners?.data.find(
        (p) =>
          p.name.toLowerCase().includes(data.partnerName.toLowerCase()) ||
          data.partnerName.toLowerCase().includes(p.name.toLowerCase()),
      );
      const taxByRate = (rate: number) =>
        taxCodes?.find((tc) => Number(tc.ratePercent) === rate)?.id ?? defaultTax;

      setHead((h) => ({
        ...h,
        partnerId: partnerMatch?.id ?? h.partnerId,
        invoiceDate: data.invoiceDate || h.invoiceDate,
        serviceDate: data.serviceDate ?? h.serviceDate,
        dueDate: data.dueDate || h.dueDate,
        reference: data.externalNumber ?? h.reference,
      }));
      setLines(
        data.lines.map((line) => ({
          description: line.description,
          quantity: String(line.quantity),
          unit: ['h', 'day', 'pcs', 'LS'].includes(line.unit) ? line.unit : 'pcs',
          unitPrice: line.unitPrice.toFixed(2),
          taxCodeId: taxByRate(line.vatRate),
          budgetCategory: '',
        })),
      );
      setAiOpen(false);
      setAiText('');
      toast(
        partnerMatch
          ? t('ai.extracted')
          : `${t('ai.extracted')} — ${t('ai.partnerNotFound', { name: data.partnerName })}`,
      );
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

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
          budgetCategory:
            isIncoming && l.budgetCategory ? l.budgetCategory : undefined,
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
      {aiStatus?.enabled && (
        <div className="mb-3">
          {!aiOpen ? (
            <Button size="sm" variant="secondary" onClick={() => setAiOpen(true)}>
              <Sparkles size={13} className="text-primary" />
              {t('ai.extractInvoice')}
            </Button>
          ) : (
            <div className="rounded-lg border border-primary/30 bg-accent/30 p-3">
              <TextArea
                rows={5}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={t('ai.extractPlaceholder')}
                className="font-mono !text-xs"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAiOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={extract.isPending || aiText.trim().length < 20}
                  onClick={() => extract.mutate()}
                >
                  {extract.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {t('ai.extract')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
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
                {isIncoming && (
                  <SelectInput
                    className="col-span-5 !text-xs"
                    value={line.budgetCategory}
                    onChange={(e) => setLine(index, { budgetCategory: e.target.value })}
                  >
                    <option value="">{t('finance.kostenart')}: —</option>
                    {expenseGroups.map((g) => (
                      <optgroup key={g.code} label={catName(g)}>
                        {g.categories.map((c) => (
                          <option key={c.code} value={c.code}>
                            {catName(c)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectInput>
                )}
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

  const settled = (i: Invoice) => ['PAID', 'CANCELLED', 'DRAFT'].includes(i.status);
  const paidShare = (i: Invoice) =>
    Number(i.grossAmount) > 0 ? (Number(i.paidAmount) / Number(i.grossAmount)) * 100 : 0;

  const columns: Column<Invoice>[] = [
    {
      header: t('finance.invoiceNumber'),
      render: (i) => <span className="font-mono text-xs">{i.invoiceNumber}</span>,
      value: (i) => i.invoiceNumber,
    },
    { header: t('contracts.partner'), render: (i) => i.partner?.name ?? '—', value: (i) => i.partner?.name },
    {
      header: t('finance.invoiceDate'),
      render: (i) => fmtDate(i.invoiceDate),
      value: (i) => i.invoiceDate,
      type: 'date',
    },
    {
      header: t('finance.dueDate'),
      render: (i) => (
        <span className="flex items-center gap-2">
          {fmtDate(i.dueDate)}
          {!settled(i) && (
            <DaysLeft
              days={daysUntil(i.dueDate)}
              label={(d) =>
                d < 0 ? t('insights.overdueBy', { count: -d }) : t('insights.daysLeft', { count: d })
              }
            />
          )}
        </span>
      ),
      value: (i) => i.dueDate,
      type: 'date',
    },
    {
      header: t('finance.net'),
      render: (i) => fmtMoney(i.netAmount, i.currencyCode),
      value: (i) => Number(i.netAmount),
      type: 'money',
      align: 'right',
      total: 'sum',
      hidden: true,
    },
    {
      header: t('finance.gross'),
      render: (i) => (
        <span className="font-medium">{fmtMoney(i.grossAmount, i.currencyCode)}</span>
      ),
      value: (i) => Number(i.grossAmount),
      type: 'money',
      align: 'right',
      bar: true,
      total: 'sum',
    },
    {
      header: t('finance.paid'),
      render: (i) => (
        <div className="ml-auto w-24">
          <Meter value={paidShare(i)} tone={paidShare(i) >= 100 ? 'success' : 'primary'} />
          <div className="mt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
            {Math.round(paidShare(i))}%
          </div>
        </div>
      ),
      value: (i) => Number(i.paidAmount),
      type: 'money',
      align: 'right',
      total: 'sum',
    },
    { header: t('common.status'), render: (i) => <StatusBadge value={i.status} />, value: (i) => i.status },
  ];

  return (
    <>
      <FinanceNav />
      <ListPage<Invoice>
        title={t('finance.title')}
        endpoint="/finance/invoices"
        columns={columns}
        summary={<OpenItemsSummary direction={direction} />}
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
