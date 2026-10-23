import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Download,
  FileText,
  FileUp,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
import { AiSummary } from '../components/ai';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import { ContractsNav } from '../components/ContractsNav';
import { RecordActions } from '../components/RecordActions';
import {
  Button,
  Dialog,
  Drawer,
  Field,
  KeyValue,
  SelectInput,
  Skeleton,
  Tabs,
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
  signedDate: string | null;
  partner?: { id: string; name: string } | null;
  contractType?: { name: string } | null;
  owner?: { firstName: string; lastName: string } | null;
}

interface ContractDetail extends Contract {
  obligations: {
    id: string;
    title: string;
    dueDate: string | null;
    recurrence: string | null;
    isFulfilled: boolean;
  }[];
  milestones: {
    id: string;
    title: string;
    amount: string;
    dueDate: string | null;
    isInvoiced: boolean;
  }[];
  variations: {
    id: string;
    voNumber: string;
    title: string;
    amount: string;
    status: string;
  }[];
  claims: {
    id: string;
    claimNumber: string;
    title: string;
    direction: string;
    amount: string | null;
    status: string;
  }[];
  versions: {
    id: string;
    version: number;
    fileId: string | null;
    changeNote: string | null;
    createdAt: string;
  }[];
}

const NEXT_STATES: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'IN_APPROVAL'],
  IN_APPROVAL: ['IN_REVIEW', 'ACTIVE'],
  ACTIVE: ['EXPIRED', 'TERMINATED'],
};

const CLAIM_STATUSES = ['OPEN', 'NOTIFIED', 'NEGOTIATION', 'SETTLED', 'REJECTED', 'LITIGATION'];

/* ------------------------------------------------------------- drawer */

export function ContractDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [renewOpen, setRenewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: contract } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get<ContractDetail>(`/contracts/${id}`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    void queryClient.invalidateQueries({ queryKey: ['/contracts'] });
  };
  const onError = (err: Error) => toast(err.message, 'error');
  const onSaved = () => {
    refresh();
    toast(t('common.saved'));
  };

  const transition = useMutation({
    mutationFn: (status: string) => api.post(`/contracts/${id}/transition`, { status }),
    onSuccess: onSaved,
    onError,
  });

  // ----- milestones
  const [msForm, setMsForm] = useState({ title: '', amount: '', dueDate: '' });
  const addMilestone = useMutation({
    mutationFn: () =>
      api.post(`/contracts/${id}/milestones`, {
        title: msForm.title,
        amount: msForm.amount,
        dueDate: msForm.dueDate || undefined,
      }),
    onSuccess: () => {
      setMsForm({ title: '', amount: '', dueDate: '' });
      onSaved();
    },
    onError,
  });
  const invoiceMilestone = useMutation({
    mutationFn: (milestoneId: string) =>
      api.post<{ invoiceNumber: string }>(`/contracts/milestones/${milestoneId}/invoice`),
    onSuccess: (invoice) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['/finance/invoices'] });
      toast(`${t('contracts.invoiceCreated')}: ${invoice.invoiceNumber}`);
    },
    onError,
  });
  const deleteMilestone = useMutation({
    mutationFn: (milestoneId: string) => api.delete(`/contracts/milestones/${milestoneId}`),
    onSuccess: onSaved,
    onError,
  });

  // ----- obligations
  const [obForm, setObForm] = useState({ title: '', dueDate: '', recurrence: '' });
  const addObligation = useMutation({
    mutationFn: () =>
      api.post(`/contracts/${id}/obligations`, {
        title: obForm.title,
        dueDate: obForm.dueDate || undefined,
        recurrence: obForm.recurrence || undefined,
      }),
    onSuccess: () => {
      setObForm({ title: '', dueDate: '', recurrence: '' });
      onSaved();
    },
    onError,
  });
  const toggleObligation = useMutation({
    mutationFn: (obligationId: string) =>
      api.patch(`/contracts/obligations/${obligationId}/fulfill`),
    onSuccess: refresh,
    onError,
  });

  // ----- variation orders
  const [voForm, setVoForm] = useState({ title: '', amount: '' });
  const addVo = useMutation({
    mutationFn: () => api.post(`/contracts/${id}/variation-orders`, voForm),
    onSuccess: () => {
      setVoForm({ title: '', amount: '' });
      onSaved();
    },
    onError,
  });
  const voStatus = useMutation({
    mutationFn: ({ voId, status }: { voId: string; status: string }) =>
      api.patch(`/contracts/variation-orders/${voId}/status`, { status }),
    onSuccess: onSaved,
    onError,
  });

  // ----- claims
  const [claimForm, setClaimForm] = useState({
    title: '',
    direction: 'OUTGOING',
    amount: '',
  });
  const addClaim = useMutation({
    mutationFn: () =>
      api.post(`/contracts/${id}/claims`, {
        title: claimForm.title,
        direction: claimForm.direction,
        amount: claimForm.amount || undefined,
      }),
    onSuccess: () => {
      setClaimForm({ title: '', direction: 'OUTGOING', amount: '' });
      onSaved();
    },
    onError,
  });
  const claimStatus = useMutation({
    mutationFn: ({ claimId, status }: { claimId: string; status: string }) =>
      api.patch(`/contracts/claims/${claimId}/status`, { status }),
    onSuccess: onSaved,
    onError,
  });

  // ----- versions
  const [versionNote, setVersionNote] = useState('');
  const uploadVersion = useMutation({
    mutationFn: (file: globalThis.File | null) => {
      const formData = new FormData();
      if (file) formData.append('file', file);
      formData.append('note', versionNote);
      return api.upload(`/contracts/${id}/versions`, formData);
    },
    onSuccess: () => {
      setVersionNote('');
      onSaved();
    },
    onError,
  });

  // ----- renew
  const [renewForm, setRenewForm] = useState({ startDate: '', endDate: '' });
  const renew = useMutation({
    mutationFn: () =>
      api.post<{ contractNumber: string }>(`/contracts/${id}/renew`, {
        startDate: renewForm.startDate,
        endDate: renewForm.endDate || undefined,
      }),
    onSuccess: (successor) => {
      refresh();
      setRenewOpen(false);
      toast(`${t('contracts.renewed')}: ${successor.contractNumber}`);
    },
    onError,
  });

  const money = (value: string | null) =>
    value
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: contract?.currencyCode ?? 'EUR',
        }).format(Number(value))
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  return (
    <Drawer open onClose={onClose} width="w-[660px]">
      {!contract ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <FileText size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-snug">{contract.title}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{contract.contractNumber}</span>
                  <StatusBadge value={contract.status} />
                  <span>{contract.partner?.name}</span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(NEXT_STATES[contract.status] ?? []).map((next) => (
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
              {contract.status === 'ACTIVE' && (
                <Button size="sm" onClick={() => setRenewOpen(true)}>
                  <RefreshCw size={13} />
                  {t('contracts.renew')}
                </Button>
              )}
            </div>
            <AiSummary entityType="contract" entityId={id} />
          </div>

          <Tabs
            tabs={[
              { key: 'overview', label: t('crm.overview') },
              {
                key: 'milestones',
                label: t('contracts.milestonesShort'),
                badge: contract.milestones.length,
              },
              {
                key: 'obligations',
                label: t('contracts.obligationsShort'),
                badge: contract.obligations.filter((o) => !o.isFulfilled).length,
              },
              { key: 'vos', label: 'VOs', badge: contract.variations.length },
              { key: 'claims', label: 'Claims', badge: contract.claims.length },
              { key: 'versions', label: t('documents.version'), badge: contract.versions.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'overview' && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                <KeyValue label={t('contracts.partner')}>{contract.partner?.name}</KeyValue>
                <KeyValue label={t('crm.type')}>{contract.contractType?.name}</KeyValue>
                <KeyValue label={t('contracts.value')}>{money(contract.value)}</KeyValue>
                <KeyValue label={t('contracts.owner')}>
                  {contract.owner
                    ? `${contract.owner.firstName} ${contract.owner.lastName}`
                    : '—'}
                </KeyValue>
                <KeyValue label={t('contracts.term')}>
                  {fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}
                </KeyValue>
                <KeyValue label={t('contracts.signed')}>{fmtDate(contract.signedDate)}</KeyValue>
              </dl>
            )}

            {tab === 'milestones' && (
              <div className="space-y-3">
                <form
                  className="grid grid-cols-12 gap-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    addMilestone.mutate();
                  }}
                >
                  <TextInput
                    className="col-span-6"
                    placeholder={t('contracts.contractTitle')}
                    value={msForm.title}
                    onChange={(e) => setMsForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                  <TextInput
                    className="col-span-3"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="€"
                    value={msForm.amount}
                    onChange={(e) => setMsForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                  <TextInput
                    className="col-span-2"
                    type="date"
                    value={msForm.dueDate}
                    onChange={(e) => setMsForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                  <Button
                    className="col-span-1"
                    size="sm"
                    type="submit"
                    disabled={addMilestone.isPending || !msForm.title || !msForm.amount}
                  >
                    <Plus size={13} />
                  </Button>
                </form>
                <ul className="space-y-1.5">
                  {contract.milestones.map((milestone) => (
                    <li
                      key={milestone.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{milestone.title}</span>
                      <RecordActions resource="milestones" id={milestone.id} label={milestone.title} />
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(milestone.dueDate)}
                      </span>
                      <span className="font-medium tabular-nums">{money(milestone.amount)}</span>
                      {milestone.isInvoiced ? (
                        <StatusBadge value="PAID" />
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={invoiceMilestone.isPending}
                            onClick={() => invoiceMilestone.mutate(milestone.id)}
                            title={t('contracts.createInvoice')}
                          >
                            <Wallet size={13} />
                            {t('contracts.createInvoice')}
                          </Button>
                          <button
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            onClick={() => deleteMilestone.mutate(milestone.id)}
                            aria-label={t('finance.removeLine')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'obligations' && (
              <div className="space-y-3">
                <form
                  className="grid grid-cols-12 gap-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    addObligation.mutate();
                  }}
                >
                  <TextInput
                    className="col-span-6"
                    placeholder={t('contracts.contractTitle')}
                    value={obForm.title}
                    onChange={(e) => setObForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                  <TextInput
                    className="col-span-3"
                    type="date"
                    value={obForm.dueDate}
                    onChange={(e) => setObForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                  <SelectInput
                    className="col-span-2"
                    value={obForm.recurrence}
                    onChange={(e) => setObForm((f) => ({ ...f, recurrence: e.target.value }))}
                  >
                    <option value="">1×</option>
                    <option value="MONTHLY">{t('legal.recurrenceType.MONTHLY')}</option>
                    <option value="QUARTERLY">{t('legal.recurrenceType.QUARTERLY')}</option>
                    <option value="YEARLY">{t('legal.recurrenceType.YEARLY')}</option>
                  </SelectInput>
                  <Button
                    className="col-span-1"
                    size="sm"
                    type="submit"
                    disabled={addObligation.isPending || !obForm.title}
                  >
                    <Plus size={13} />
                  </Button>
                </form>
                <ul className="space-y-1.5">
                  {contract.obligations.map((obligation) => (
                    <li
                      key={obligation.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={obligation.isFulfilled}
                        onChange={() => toggleObligation.mutate(obligation.id)}
                        className="accent-[hsl(var(--primary))]"
                      />
                      <span
                        className={`min-w-0 flex-1 ${
                          obligation.isFulfilled ? 'line-through opacity-60' : ''
                        }`}
                      >
                        {obligation.title}
                        {obligation.recurrence && (
                          <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px]">
                            {t(`legal.recurrenceType.${obligation.recurrence}`, obligation.recurrence)}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(obligation.dueDate)}
                      </span>
                      <RecordActions resource="obligations" id={obligation.id} label={obligation.title} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'vos' && (
              <div className="space-y-3">
                <form
                  className="grid grid-cols-12 gap-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    addVo.mutate();
                  }}
                >
                  <TextInput
                    className="col-span-8"
                    placeholder={t('contracts.voTitle')}
                    value={voForm.title}
                    onChange={(e) => setVoForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                  <TextInput
                    className="col-span-3"
                    type="number"
                    step="0.01"
                    placeholder="€"
                    value={voForm.amount}
                    onChange={(e) => setVoForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                  <Button
                    className="col-span-1"
                    size="sm"
                    type="submit"
                    disabled={addVo.isPending || !voForm.title || !voForm.amount}
                  >
                    <Plus size={13} />
                  </Button>
                </form>
                <ul className="space-y-1.5">
                  {contract.variations.map((vo) => (
                    <li
                      key={vo.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs">{vo.voNumber}</span>
                      <span className="min-w-0 flex-1 truncate">{vo.title}</span>
                      <span className="font-medium tabular-nums">{money(vo.amount)}</span>
                      <StatusBadge value={vo.status} />
                      <RecordActions resource="variations" id={vo.id} label={vo.title} />
                      {vo.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => voStatus.mutate({ voId: vo.id, status: 'SUBMITTED' })}
                        >
                          <Send size={12} />
                        </Button>
                      )}
                      {vo.status === 'SUBMITTED' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => voStatus.mutate({ voId: vo.id, status: 'APPROVED' })}
                          >
                            <Check size={12} className="text-success" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => voStatus.mutate({ voId: vo.id, status: 'REJECTED' })}
                          >
                            <X size={12} className="text-destructive" />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'claims' && (
              <div className="space-y-3">
                <form
                  className="grid grid-cols-12 gap-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    addClaim.mutate();
                  }}
                >
                  <TextInput
                    className="col-span-6"
                    placeholder={t('contracts.claimTitle')}
                    value={claimForm.title}
                    onChange={(e) => setClaimForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                  <SelectInput
                    className="col-span-3"
                    value={claimForm.direction}
                    onChange={(e) =>
                      setClaimForm((f) => ({ ...f, direction: e.target.value }))
                    }
                  >
                    <option value="OUTGOING">{t('contracts.claimOut')}</option>
                    <option value="INCOMING">{t('contracts.claimIn')}</option>
                  </SelectInput>
                  <TextInput
                    className="col-span-2"
                    type="number"
                    step="0.01"
                    placeholder="€"
                    value={claimForm.amount}
                    onChange={(e) => setClaimForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  <Button
                    className="col-span-1"
                    size="sm"
                    type="submit"
                    disabled={addClaim.isPending || !claimForm.title}
                  >
                    <Plus size={13} />
                  </Button>
                </form>
                <ul className="space-y-1.5">
                  {contract.claims.map((claim) => (
                    <li
                      key={claim.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs">{claim.claimNumber}</span>
                      <span className="min-w-0 flex-1 truncate">{claim.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {claim.direction === 'OUTGOING'
                          ? t('contracts.claimOut')
                          : t('contracts.claimIn')}
                      </span>
                      <span className="font-medium tabular-nums">{money(claim.amount)}</span>
                      <RecordActions resource="claims" id={claim.id} label={claim.title} />
                      <SelectInput
                        className="!w-36"
                        value={claim.status}
                        onChange={(e) =>
                          claimStatus.mutate({ claimId: claim.id, status: e.target.value })
                        }
                      >
                        {CLAIM_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(`contracts.claimStatus.${status}`, status)}
                          </option>
                        ))}
                      </SelectInput>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'versions' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <TextInput
                    placeholder={t('contracts.changeNote')}
                    value={versionNote}
                    onChange={(e) => setVersionNote(e.target.value)}
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      uploadVersion.mutate(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={uploadVersion.isPending}
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp size={13} />
                    {t('documents.upload')}
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {contract.versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">
                        v{version.version}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {version.changeNote ?? '—'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(version.createdAt)}
                      </span>
                      {version.fileId && (
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                          onClick={() =>
                            void api
                              .download(
                                `/documents/${version.fileId}/download`,
                                `contract-v${version.version}`,
                              )
                              .catch(onError)
                          }
                          aria-label={t('documents.download')}
                        >
                          <Download size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Dialog
            open={renewOpen}
            onClose={() => setRenewOpen(false)}
            title={t('contracts.renew')}
          >
            <form
              className="space-y-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                renew.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('leave.from')} required>
                  <TextInput
                    type="date"
                    value={renewForm.startDate}
                    onChange={(e) =>
                      setRenewForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label={t('leave.to')}>
                  <TextInput
                    type="date"
                    value={renewForm.endDate}
                    onChange={(e) => setRenewForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">{t('contracts.renewHint')}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRenewOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={renew.isPending || !renewForm.startDate}>
                  {t('contracts.renew')}
                </Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------- create dialog */

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
              {partners?.data.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
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

/* ---------------------------------------------------------------- page */

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
      <ContractsNav />
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
