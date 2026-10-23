import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import { SubNav } from '../components/SubNav';
import {
  Button,
  Dialog,
  Field,
  SelectInput,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';

interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  dueDate: string | null;
  recurrence: string | null;
  status: string;
}

interface LegalCase {
  id: string;
  caseNumber: string;
  title: string;
  type: string;
  status: string;
  amountInDispute: string | null;
  externalCounsel: string | null;
  partner?: { name: string } | null;
}

const COMPLIANCE_CATEGORIES = [
  'GDPR', 'ISO_9001', 'ISO_14001', 'ISO_45001', 'LICENSE', 'REGISTER', 'TAX', 'OTHER',
];
const COMPLIANCE_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE',
];
const CASE_TYPES = ['LITIGATION', 'ARBITRATION', 'ADMINISTRATIVE', 'EMPLOYMENT', 'IP'];

function NewComplianceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    category: 'GDPR',
    title: '',
    description: '',
    dueDate: '',
    recurrence: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post('/legal/compliance-items', {
        category: form.category,
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate || undefined,
        recurrence: form.recurrence || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/legal/compliance-items'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('legal.newItem')}>
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
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('corporate.category')}>
            <SelectInput value={form.category} onChange={set('category')}>
              {COMPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('finance.dueDate')}>
            <TextInput type="date" value={form.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label={t('legal.recurrence')}>
            <SelectInput value={form.recurrence} onChange={set('recurrence')}>
              <option value="">—</option>
              {['YEARLY', 'QUARTERLY', 'MONTHLY'].map((r) => (
                <option key={r} value={r}>
                  {t(`legal.recurrenceType.${r}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field label={t('finance.description')}>
          <TextArea value={form.description} onChange={set('description')} rows={2} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !form.title.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    caseNumber: '',
    title: '',
    type: 'LITIGATION',
    externalCounsel: '',
    amountInDispute: '',
    description: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post('/legal/cases', {
        caseNumber: form.caseNumber,
        title: form.title,
        type: form.type,
        externalCounsel: form.externalCounsel || undefined,
        amountInDispute: form.amountInDispute || undefined,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/legal/cases'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('legal.newCase')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('legal.caseNumber')} required>
            <TextInput
              value={form.caseNumber}
              onChange={set('caseNumber')}
              placeholder="AZ 12 O 345/26"
              required
              autoFocus
            />
          </Field>
          <Field label={t('crm.type')}>
            <SelectInput value={form.type} onChange={set('type')}>
              {CASE_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`legal.caseType.${c}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field label={t('contracts.contractTitle')} required>
          <TextInput value={form.title} onChange={set('title')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('legal.counsel')}>
            <TextInput value={form.externalCounsel} onChange={set('externalCounsel')} />
          </Field>
          <Field label={`${t('legal.amountInDispute')} (€)`}>
            <TextInput
              type="number"
              min="0"
              value={form.amountInDispute}
              onChange={set('amountInDispute')}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !form.title.trim() || !form.caseNumber.trim()}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function LegalPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'compliance' | 'cases'>('compliance');
  const [createOpen, setCreateOpen] = useState(false);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/legal/compliance-items/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/legal/compliance-items'] });
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';
  const fmtMoney = (v: string | null) =>
    v
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
          Number(v),
        )
      : '—';

  const complianceColumns: Column<ComplianceItem>[] = [
    { header: t('corporate.category'), render: (c) => c.category.replace('_', ' ') },
    {
      header: t('contracts.contractTitle'),
      render: (c) => <span className="font-medium">{c.title}</span>,
    },
    { header: t('finance.dueDate'), render: (c) => fmtDate(c.dueDate), value: (c) => c.dueDate, type: 'date' },
    {
      header: t('legal.recurrence'),
      render: (c) => (c.recurrence ? t(`legal.recurrenceType.${c.recurrence}`) : '—'),
    },
    {
      header: t('common.status'),
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <SelectInput
            className="!w-40"
            value={c.status}
            onChange={(e) => setStatus.mutate({ id: c.id, status: e.target.value })}
          >
            {COMPLIANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`legal.complianceStatus.${s}`)}
              </option>
            ))}
          </SelectInput>
        </span>
      ),
    },
  ];

  const caseColumns: Column<LegalCase>[] = [
    {
      header: t('legal.caseNumber'),
      render: (c) => <span className="font-mono text-xs">{c.caseNumber}</span>,
    },
    {
      header: t('contracts.contractTitle'),
      render: (c) => <span className="font-medium">{c.title}</span>,
    },
    { header: t('crm.type'), render: (c) => t(`legal.caseType.${c.type}`) },
    { header: t('legal.counsel'), render: (c) => c.externalCounsel ?? '—' },
    {
      header: t('legal.amountInDispute'),
      render: (c) => fmtMoney(c.amountInDispute),
      value: (c) => c.amountInDispute == null ? null : Number(c.amountInDispute),
      type: 'money',
      bar: true,
      total: 'sum',
      align: 'right',
    },
    { header: t('common.status'), render: (c) => <StatusBadge value={c.status} /> },
  ];

  return (
    <>
      <SubNav
        items={[
          { label: t('legal.compliance'), to: '/legal' },
          { label: t('legal.cases'), to: '/legal/cases' },
        ]}
      />
      {/* tab derives from URL via SubNav; local state mirrors it for simplicity */}
      {location.pathname.endsWith('/cases') ? (
        <ListPage<LegalCase>
          title={t('legal.cases')}
          endpoint="/legal/cases"
          columns={caseColumns}
          toolbar={
            <Button
              onClick={() => {
                setTab('cases');
                setCreateOpen(true);
              }}
            >
              <Plus size={14} />
              {t('common.new')}
            </Button>
          }
        />
      ) : (
        <ListPage<ComplianceItem>
          title={t('legal.compliance')}
          endpoint="/legal/compliance-items"
          columns={complianceColumns}
          toolbar={
            <Button
              onClick={() => {
                setTab('compliance');
                setCreateOpen(true);
              }}
            >
              <Plus size={14} />
              {t('common.new')}
            </Button>
          }
        />
      )}
      {tab === 'compliance' ? (
        <NewComplianceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      ) : (
        <NewCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
    </>
  );
}
