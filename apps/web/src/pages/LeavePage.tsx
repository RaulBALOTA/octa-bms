import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
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
import { hasPermission, useAuthStore } from '../stores/auth';

interface LeaveRequest {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  days: string;
  note: string | null;
  employee: { id: string; firstName: string; lastName: string };
}

const LEAVE_TYPES = [
  'VACATION',
  'SICK',
  'SPECIAL',
  'UNPAID',
  'HOME_OFFICE',
  'OVERTIME_COMPENSATION',
] as const;

function RequestLeaveDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employeeId: '',
    type: 'VACATION',
    startDate: '',
    endDate: '',
    note: '',
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-for-select'],
    queryFn: () =>
      api.get<Paged<{ id: string; firstName: string; lastName: string }>>(
        '/hr/employees?pageSize=200',
      ),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/hr/leave-requests', {
        employeeId: form.employeeId,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/hr/leave-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      toast(t('leave.requested'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('leave.newRequest')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.title')} required>
            <SelectInput
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
              required
            >
              <option value="">—</option>
              {employees?.data.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.lastName}, {emp.firstName}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('crm.type')} required>
            <SelectInput
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`leave.type.${type}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('leave.from')} required>
            <TextInput
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('leave.to')} required>
            <TextInput
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              required
            />
          </Field>
        </div>
        <Field label={t('crm.notes')}>
          <TextArea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            rows={2}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              create.isPending || !form.employeeId || !form.startDate || !form.endDate
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function LeavePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const canApprove = hasPermission(me, 'hr.leave.approve');
  const [createOpen, setCreateOpen] = useState(false);

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api.post(`/hr/leave-requests/${id}/decide`, { decision }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/hr/leave-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  const columns: Column<LeaveRequest>[] = [
    {
      header: t('hr.title'),
      render: (r) => (
        <span className="font-medium">
          {r.employee.lastName}, {r.employee.firstName}
        </span>
      ),
    },
    { header: t('crm.type'), render: (r) => t(`leave.type.${r.type}`) },
    {
      header: t('leave.period'),
      render: (r) => `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}`,
    },
    { header: t('leave.days'), render: (r) => Number(r.days), align: 'right' },
    { header: t('common.status'), render: (r) => <StatusBadge value={r.status} /> },
    {
      header: '',
      render: (r) =>
        canApprove && r.status === 'REQUESTED' ? (
          <span
            className="flex justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}
            >
              <Check size={13} className="text-success" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => decide.mutate({ id: r.id, decision: 'REJECTED' })}
            >
              <X size={13} className="text-destructive" />
            </Button>
          </span>
        ) : null,
      align: 'right',
    },
  ];

  return (
    <>
      <SubNav
        items={[
          { label: t('hr.title'), to: '/hr/employees' },
          { label: t('nav.leave'), to: '/hr/leave' },
        ]}
      />
      <ListPage<LeaveRequest>
        title={t('leave.title')}
        endpoint="/hr/leave-requests"
        columns={columns}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      <RequestLeaveDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
