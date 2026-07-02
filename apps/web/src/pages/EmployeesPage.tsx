import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import { SubNav } from '../components/SubNav';
import {
  Avatar,
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

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  title: string | null;
  discipline: string | null;
  status: string;
  workEmail: string | null;
  phone: string | null;
  mobile: string | null;
  hireDate: string | null;
  weeklyHours: string | null;
  department?: { name: string } | null;
  office?: { name: string; city?: string | null } | null;
  position?: { name: string; level?: string | null } | null;
  manager?: { firstName: string; lastName: string } | null;
}

interface EmployeeDetail extends Employee {
  skills: { id: string; level: number; skill: { name: string; category: string } }[];
  certificates: { id: string; name: string; expiryDate: string | null }[];
  leaveBalances: { year: number; entitlement: string; carryOver: string; taken: string }[];
  assetAssignments: { id: string; asset: { assetNumber: string; name: string } }[];
}

function SkillDots({ level }: { level: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${level}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < level ? 'bg-primary' : 'bg-muted'
          }`}
        />
      ))}
    </span>
  );
}

function EmployeeDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();

  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get<EmployeeDetail>(`/hr/employees/${id}`),
  });

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const balance = employee?.leaveBalances[0];
  const remaining = balance
    ? Number(balance.entitlement) + Number(balance.carryOver) - Number(balance.taken)
    : null;

  return (
    <Drawer open onClose={onClose}>
      {!employee ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-center gap-3">
              <Avatar name={`${employee.firstName} ${employee.lastName}`} size={44} />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">
                  {employee.title ? `${employee.title} ` : ''}
                  {employee.firstName} {employee.lastName}
                </h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{employee.employeeNumber}</span>
                  <span>{employee.position?.name}</span>
                  <StatusBadge value={employee.status} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <KeyValue label={t('hr.discipline')}>{employee.discipline}</KeyValue>
              <KeyValue label={t('hr.department')}>{employee.department?.name}</KeyValue>
              <KeyValue label={t('hr.office')}>{employee.office?.name}</KeyValue>
              <KeyValue label={t('hr.manager')}>
                {employee.manager
                  ? `${employee.manager.firstName} ${employee.manager.lastName}`
                  : '—'}
              </KeyValue>
              <KeyValue label={t('auth.email')}>
                {employee.workEmail ? (
                  <a
                    href={`mailto:${employee.workEmail}`}
                    className="text-primary hover:underline"
                  >
                    {employee.workEmail}
                  </a>
                ) : (
                  '—'
                )}
              </KeyValue>
              <KeyValue label={t('hr.hireDate')}>{fmtDate(employee.hireDate)}</KeyValue>
            </dl>

            {balance && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('hr.leaveBalance')} {balance.year}
                </h3>
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>
                      {Number(balance.taken)} / {Number(balance.entitlement) + Number(balance.carryOver)}{' '}
                      {t('hr.daysTaken')}
                    </span>
                    <span className="font-medium text-success">
                      {remaining} {t('hr.daysLeft')}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(
                          100,
                          (Number(balance.taken) /
                            (Number(balance.entitlement) + Number(balance.carryOver))) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('hr.skills')} ({employee.skills.length})
              </h3>
              {employee.skills.length ? (
                <ul className="space-y-1.5">
                  {employee.skills.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span>{s.skill.name}</span>
                      <SkillDots level={s.level} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('hr.equipment')} ({employee.assetAssignments.length})
              </h3>
              {employee.assetAssignments.length ? (
                <ul className="space-y-1.5">
                  {employee.assetAssignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <Laptop size={14} className="text-muted-foreground" />
                      <span className="font-mono text-xs">{a.asset.assetNumber}</span>
                      {a.asset.name}
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

function NewEmployeeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employeeNumber: '',
    firstName: '',
    lastName: '',
    discipline: '',
    workEmail: '',
    departmentId: '',
    officeId: '',
    positionId: '',
    hireDate: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/departments'),
    enabled: open,
  });
  const { data: offices } = useQuery({
    queryKey: ['offices'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/offices'),
    enabled: open,
  });
  const { data: positions } = useQuery({
    queryKey: ['positions'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/positions'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/hr/employees', {
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        discipline: form.discipline || undefined,
        workEmail: form.workEmail || undefined,
        departmentId: form.departmentId || undefined,
        officeId: form.officeId || undefined,
        positionId: form.positionId || undefined,
        hireDate: form.hireDate || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/hr/employees'] });
      void queryClient.invalidateQueries({ queryKey: ['kpis'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('hr.newEmployee')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.employeeNumber')} required>
            <TextInput
              value={form.employeeNumber}
              onChange={set('employeeNumber')}
              placeholder="E-0006"
              required
              autoFocus
            />
          </Field>
          <Field label={t('hr.hireDate')}>
            <TextInput type="date" value={form.hireDate} onChange={set('hireDate')} />
          </Field>
          <Field label={t('hr.firstName')} required>
            <TextInput value={form.firstName} onChange={set('firstName')} required />
          </Field>
          <Field label={t('hr.lastName')} required>
            <TextInput value={form.lastName} onChange={set('lastName')} required />
          </Field>
          <Field label={t('hr.discipline')}>
            <TextInput value={form.discipline} onChange={set('discipline')} />
          </Field>
          <Field label={t('auth.email')}>
            <TextInput type="email" value={form.workEmail} onChange={set('workEmail')} />
          </Field>
          <Field label={t('hr.department')}>
            <SelectInput value={form.departmentId} onChange={set('departmentId')}>
              <option value="">—</option>
              {departments?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('hr.office')}>
            <SelectInput value={form.officeId} onChange={set('officeId')}>
              <option value="">—</option>
              {offices?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('hr.position')}>
            <SelectInput value={form.positionId} onChange={set('positionId')}>
              <option value="">—</option>
              {positions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              create.isPending ||
              !form.employeeNumber.trim() ||
              !form.firstName.trim() ||
              !form.lastName.trim()
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function EmployeesPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns: Column<Employee>[] = [
    {
      header: t('hr.employeeNumber'),
      render: (e) => <span className="font-mono text-xs">{e.employeeNumber}</span>,
    },
    {
      header: t('crm.name'),
      render: (e) => (
        <span className="flex items-center gap-2 font-medium">
          <Avatar name={`${e.firstName} ${e.lastName}`} size={22} />
          {e.lastName}, {e.firstName}
        </span>
      ),
    },
    { header: t('hr.discipline'), render: (e) => e.discipline ?? '—' },
    { header: t('hr.position'), render: (e) => e.position?.name ?? '—' },
    { header: t('hr.department'), render: (e) => e.department?.name ?? '—' },
    { header: t('hr.office'), render: (e) => e.office?.name ?? '—' },
    { header: t('common.status'), render: (e) => <StatusBadge value={e.status} /> },
  ];

  return (
    <>
      <SubNav
        items={[
          { label: t('hr.title'), to: '/hr/employees' },
          { label: t('nav.leave'), to: '/hr/leave' },
        ]}
      />
      <ListPage<Employee>
        title={t('hr.title')}
        endpoint="/hr/employees"
        columns={columns}
        onRowClick={(e) => setSelectedId(e.id)}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      {selectedId && (
        <EmployeeDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <NewEmployeeDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
