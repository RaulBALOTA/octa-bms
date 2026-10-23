import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Send, ShoppingCart, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
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
import { hasPermission, useAuthStore } from '../stores/auth';

interface PurchaseRequest {
  id: string;
  requestNumber: string;
  category: string;
  status: string;
  neededBy: string | null;
  justification: string | null;
  totalEstimate: string | null;
  createdAt: string;
  items: {
    id: string;
    description: string;
    quantity: string;
    unit: string;
    estimatedPrice: string | null;
  }[];
}

const CATEGORIES = ['IT', 'SOFTWARE', 'OFFICE', 'VEHICLE', 'FURNITURE', 'SERVICE', 'OTHER'];

interface ItemDraft {
  description: string;
  quantity: string;
  unit: string;
  estimatedPrice: string;
}

function NewRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const emptyItem = (): ItemDraft => ({
    description: '',
    quantity: '1',
    unit: 'pcs',
    estimatedPrice: '',
  });
  const [category, setCategory] = useState('IT');
  const [justification, setJustification] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);

  const setItem = (index: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const total = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.estimatedPrice || 0),
    0,
  );
  const money = (v: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(v);

  const valid = items.length > 0 && items.every((item) => item.description.trim());

  const create = useMutation({
    mutationFn: () =>
      api.post<{ requestNumber: string }>('/procurement/requests', {
        category,
        justification: justification || undefined,
        neededBy: neededBy || undefined,
        items: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          estimatedPrice: item.estimatedPrice || undefined,
        })),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['/procurement/requests'] });
      toast(`${created.requestNumber} ${t('common.created')}`);
      onClose();
      setItems([emptyItem()]);
      setJustification('');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('procurement.newRequest')} width="max-w-2xl">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('corporate.category')} required>
            <SelectInput value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`procurement.category.${c}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('procurement.neededBy')}>
            <TextInput type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </Field>
        </div>
        <Field label={t('procurement.justification')}>
          <TextArea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={2}
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('finance.lines')}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setItems((list) => [...list, emptyItem()])}
            >
              <Plus size={13} />
              {t('finance.addLine')}
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 items-center gap-2">
                <TextInput
                  className="col-span-6"
                  placeholder={t('finance.description')}
                  value={item.description}
                  onChange={(e) => setItem(index, { description: e.target.value })}
                  required
                />
                <TextInput
                  className="col-span-2"
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(e) => setItem(index, { quantity: e.target.value })}
                />
                <TextInput
                  className="col-span-3"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="€ / pcs"
                  value={item.estimatedPrice}
                  onChange={(e) => setItem(index, { estimatedPrice: e.target.value })}
                />
                <button
                  type="button"
                  className="col-span-1 justify-self-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-30"
                  disabled={items.length === 1}
                  onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                  aria-label={t('finance.removeLine')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">
            {t('procurement.estimate')}:{' '}
            <strong className="text-foreground">{money(total)}</strong>
          </span>
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

function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);

  const { data: request } = useQuery({
    queryKey: ['purchase-request', id],
    queryFn: () => api.get<PurchaseRequest>(`/procurement/requests/${id}`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase-request', id] });
    void queryClient.invalidateQueries({ queryKey: ['/procurement/requests'] });
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  const submit = useMutation({
    mutationFn: () => api.post(`/procurement/requests/${id}/submit`),
    onSuccess: () => {
      refresh();
      toast(t('procurement.submitted'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api.post(`/procurement/requests/${id}/decide`, { decision }),
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (v: string | null) =>
    v
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
          Number(v),
        )
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  return (
    <Drawer open onClose={onClose}>
      {!request ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <ShoppingCart size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">{request.requestNumber}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t(`procurement.category.${request.category}`)}</span>
                  <StatusBadge value={request.status} />
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              {request.status === 'DRAFT' && (
                <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>
                  <Send size={13} />
                  {t('procurement.submit')}
                </Button>
              )}
              {request.status === 'SUBMITTED' &&
                hasPermission(me, 'procurement.requests.approve') && (
                  <>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate('APPROVED')}
                    >
                      <Check size={13} />
                      {t('approvals.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate('REJECTED')}
                    >
                      <X size={13} className="text-destructive" />
                      {t('approvals.reject')}
                    </Button>
                  </>
                )}
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <KeyValue label={t('procurement.neededBy')}>{fmtDate(request.neededBy)}</KeyValue>
              <KeyValue label={t('procurement.estimate')}>
                {money(request.totalEstimate)}
              </KeyValue>
              <KeyValue label={t('procurement.justification')}>
                {request.justification}
              </KeyValue>
            </dl>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('finance.lines')} ({request.items.length})
              </h3>
              <ul className="space-y-1.5">
                {request.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span>{item.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {Number(item.quantity)} {item.unit}
                      {item.estimatedPrice ? ` × ${money(item.estimatedPrice)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function ProcurementPage() {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const money = (v: string | null) =>
    v
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
          Number(v),
        )
      : '—';

  const columns: Column<PurchaseRequest>[] = [
    {
      header: t('crm.number'),
      render: (r) => <span className="font-mono text-xs">{r.requestNumber}</span>,
    },
    {
      header: t('corporate.category'),
      render: (r) => t(`procurement.category.${r.category}`),
    },
    {
      header: t('finance.lines'),
      render: (r) => r.items.map((item) => item.description).join(', '),
    },
    {
      header: t('procurement.estimate'),
      render: (r) => money(r.totalEstimate),
      align: 'right',
    },
    { header: t('common.status'), render: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <>
      <ListPage<PurchaseRequest>
        title={t('procurement.title')}
        endpoint="/procurement/requests"
        columns={columns}
        onRowClick={(r) => setSelectedId(r.id)}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      {selectedId && <RequestDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
      <NewRequestDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
