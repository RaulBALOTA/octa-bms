import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
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

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  status: string;
  value: string | null;
  currencyCode: string;
  startDate: string | null;
  endDate: string | null;
  noticePeriodDays: number | null;
  autoRenewal: boolean;
  signedDate: string | null;
  riskLevel: string | null;
  partner?: { name: string } | null;
  contractType?: { name: string } | null;
  owner?: { firstName: string; lastName: string } | null;
}

interface ContractDetail extends Contract {
  obligations: { id: string; title: string; dueDate: string | null; isFulfilled: boolean }[];
  milestones: { id: string; title: string; amount: string; isInvoiced: boolean }[];
  variations: { id: string; voNumber: string; title: string; amount: string; status: string }[];
}

/** Mirror of the backend transition map — drives which action buttons show. */
const NEXT_STATES: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'IN_APPROVAL'],
  IN_APPROVAL: ['IN_REVIEW', 'ACTIVE'],
  ACTIVE: ['RENEWED', 'EXPIRED', 'TERMINATED'],
};

function ContractDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: contract } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get<ContractDetail>(`/contracts/${id}`),
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      api.post(`/contracts/${id}/transition`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
      void queryClient.invalidateQueries({ queryKey: ['/contracts'] });
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: string | null, currency = 'EUR') =>
    value
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(
          Number(value),
        )
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  return (
    <Drawer open onClose={onClose}>
      {!contract ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <FileText size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-snug">{contract.title}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{contract.contractNumber}</span>
                  <StatusBadge value={contract.status} />
                </div>
              </div>
            </div>
            {(NEXT_STATES[contract.status] ?? []).length > 0 && (
              <div className="mt-3 flex gap-2">
                {NEXT_STATES[contract.status].map((next) => (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === 'TERMINATED' ? 'destructive' : 'secondary'}
                    disabled={transition.isPending}
                    onClick={() => transition.mutate(next)}
                  >
                    → {t(`contracts.status.${next}`, next)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <KeyValue label={t('contracts.partner')}>{contract.partner?.name}</KeyValue>
              <KeyValue label={t('crm.type')}>{contract.contractType?.name}</KeyValue>
              <KeyValue label={t('contracts.value')}>
                {money(contract.value, contract.currencyCode)}
              </KeyValue>
              <KeyValue label={t('contracts.owner')}>
                {contract.owner
                  ? `${contract.owner.firstName} ${contract.owner.lastName}`
                  : '—'}
              </KeyValue>
              <KeyValue label={t('contracts.term')}>
                {fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}
              </KeyValue>
              <KeyValue label={t('contracts.signed')}>
                {fmtDate(contract.signedDate)}
              </KeyValue>
            </dl>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('contracts.milestones')} ({contract.milestones.length})
              </h3>
              {contract.milestones.length ? (
                <ul className="space-y-1.5">
                  {contract.milestones.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span>{m.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">{money(m.amount)}</span>
                        <StatusBadge value={m.isInvoiced ? 'PAID' : 'DRAFT'} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('contracts.obligations')} ({contract.obligations.length})
              </h3>
              {contract.obligations.length ? (
                <ul className="space-y-1.5">
                  {contract.obligations.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className={o.isFulfilled ? 'line-through opacity-60' : ''}>
                        {o.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(o.dueDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

function NewContractDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    contractTypeId: '',
    partnerId: '',
    value: '',
    startDate: '',
    endDate: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: types } = useQuery({
    queryKey: ['contract-types'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/contract-types'),
    enabled: open,
  });
  const { data: partners } = useQuery({
    queryKey: ['partners-for-contract'],
    queryFn: () =>
      api.get<Paged<{ id: string; name: string }>>('/crm/partners?pageSize=200&sort=name'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ contractNumber: string }>('/contracts', {
        title: form.title,
        contractTypeId: form.contractTypeId,
        partnerId: form.partnerId || undefined,
        value: form.value || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['/contracts'] });
      toast(`${created.contractNumber} ${t('common.created')}`);
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('contracts.newContract')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('contracts.contractTitle')} required>
          <TextInput value={form.title} onChange={set('title')} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.type')} required>
            <SelectInput value={form.contractTypeId} onChange={set('contractTypeId')} required>
              <option value="">—</option>
              {types?.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('contracts.partner')}>
            <SelectInput value={form.partnerId} onChange={set('partnerId')}>
              <option value="">—</option>
              {partners?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={`${t('contracts.value')} (€)`}>
            <TextInput type="number" min="0" step="1000" value={form.value} onChange={set('value')} />
          </Field>
          <span />
          <Field label={t('leave.from')}>
            <TextInput type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>
          <Field label={t('leave.to')}>
            <TextInput type="date" value={form.endDate} onChange={set('endDate')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !form.title.trim() || !form.contractTypeId}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ContractsPage() {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fmtMoney = (value: string | null, currency: string) =>
    value
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(
          Number(value),
        )
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const columns: Column<Contract>[] = [
    {
      header: t('contracts.number'),
      render: (c) => <span className="font-mono text-xs">{c.contractNumber}</span>,
    },
    {
      header: t('contracts.contractTitle'),
      render: (c) => <span className="font-medium">{c.title}</span>,
    },
    { header: t('contracts.partner'), render: (c) => c.partner?.name ?? '—' },
    { header: t('crm.type'), render: (c) => c.contractType?.name ?? '—' },
    {
      header: t('contracts.value'),
      render: (c) => fmtMoney(c.value, c.currencyCode),
      align: 'right',
    },
    {
      header: t('contracts.endDate'),
      render: (c) => fmtDate(c.endDate),
      align: 'right',
    },
    { header: t('common.status'), render: (c) => <StatusBadge value={c.status} /> },
  ];

  return (
    <>
      <ListPage<Contract>
        title={t('contracts.title')}
        endpoint="/contracts"
        columns={columns}
        onRowClick={(c) => setSelectedId(c.id)}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      {selectedId && (
        <ContractDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <NewContractDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
