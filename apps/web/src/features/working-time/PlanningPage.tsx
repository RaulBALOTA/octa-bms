import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, SelectInput, Skeleton, TextInput, useToast } from '../../components/ui';
import { api, Paged } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { addDays, formatHours, localDay, shortDate, utilizationTone, weekStartOf } from './format';
import { TimeNav, WeekNavigator, useInvalidateTime, useProjects, useTimeKey } from './shared';
import type { CapacityBoard } from './types';

const TONE = {
  none: 'bg-muted/40 text-muted-foreground',
  low: 'bg-primary/5',
  ok: 'bg-success/10',
  high: 'bg-warning/15',
  over: 'bg-destructive/15 text-destructive',
};

interface AllocationDraft { employeeId: string; projectCode: string; fromWeek: string; toWeek: string; hours: string }

function AllocationDialog({ draft, onClose, employees }: {
  draft: AllocationDraft | null; onClose: () => void; employees: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const projects = useProjects();
  const [form, setForm] = useState<AllocationDraft & { customCode: string; projectName: string }>({ employeeId: '', projectCode: '', fromWeek: '', toWeek: '', hours: '', customCode: '', projectName: '' });
  useEffect(() => { if (draft) setForm({ ...draft, customCode: '', projectName: '' }); }, [draft]);
  const custom = form.projectCode === '__other';
  const code = custom ? form.customCode.trim() : form.projectCode;
  const save = useMutation({
    mutationFn: () => api.post('/time/allocations', {
      employeeId: form.employeeId, projectCode: code, projectName: custom ? form.projectName || undefined : undefined,
      fromWeek: form.fromWeek, toWeek: form.toWeek, hoursPerWeek: Number(form.hours.replace(',', '.')),
    }),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={!!draft} onClose={onClose} title={t('time.planning.allocateTitle')}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label={t('time.employee')} required>
          <SelectInput value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} required>
            <option value="">—</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('time.project')} required>
          <SelectInput value={form.projectCode} onChange={(e) => set({ projectCode: e.target.value })} required>
            <option value="">{t('time.chooseProject')}</option>
            {projects.data?.filter((p) => p.isActive).map((p) => <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''}</option>)}
            <option value="__other">{t('time.otherProject')}</option>
          </SelectInput>
        </Field>
        {custom && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('time.projectCode')} required><TextInput value={form.customCode} onChange={(e) => set({ customCode: e.target.value })} required /></Field>
            <Field label={t('time.projectName')}><TextInput value={form.projectName} onChange={(e) => set({ projectName: e.target.value })} /></Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('time.planning.fromWeek')} required><TextInput type="date" value={form.fromWeek} onChange={(e) => set({ fromWeek: e.target.value })} required /></Field>
          <Field label={t('time.planning.toWeek')} required><TextInput type="date" value={form.toWeek} onChange={(e) => set({ toWeek: e.target.value })} required /></Field>
          <Field label={t('time.planning.hoursPerWeek')} required><TextInput inputMode="decimal" value={form.hours} onChange={(e) => set({ hours: e.target.value })} required /></Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('time.planning.zeroRemoves')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !form.employeeId || !code || form.hours === ''}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PlanningPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const invalidate = useInvalidateTime();
  const canPlan = hasPermission(me, 'time.planning.create');
  const [from, setFrom] = useState(() => weekStartOf(localDay()));
  const [weeks, setWeeks] = useState(8);
  const [projectCode, setProjectCode] = useState('');
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const projects = useProjects();

  const board = useQuery({
    queryKey: key('capacity', from, weeks, projectCode),
    queryFn: () => api.get<CapacityBoard>(`/time/capacity?from=${from}&weeks=${weeks}${projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ''}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/time/allocations/${id}`),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const hours = (minutes: number) => formatHours(minutes, i18n.language);
  // The board may be filtered by project; offer every employee when the HR list is readable.
  const allEmployees = useQuery({
    queryKey: key('employees'),
    queryFn: () => api.get<Paged<{ id: string; firstName: string; lastName: string }>>('/hr/employees?pageSize=200'),
    enabled: canPlan && hasPermission(me, 'hr.employees.read'),
  });
  const employees = (allEmployees.data?.data ?? board.data?.rows.map((r) => r.employee) ?? [])
    .map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}` }));
  const newDraft = (employeeId = '', weekStart = from): AllocationDraft => ({ employeeId, projectCode: projectCode || '', fromWeek: weekStart, toWeek: addDays(weekStart, (weeks - 1) * 7), hours: '' });

  return (
    <div>
      <TimeNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('time.nav.planning')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-60">
            <SelectInput value={projectCode} onChange={(e) => setProjectCode(e.target.value)} aria-label={t('time.project')}>
              <option value="">{t('time.planning.filterProject')}</option>
              {projects.data?.map((p) => <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''}</option>)}
            </SelectInput>
          </div>
          <div className="w-32">
            <SelectInput value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label={t('time.planning.weeks')}>
              {[4, 8, 12, 26].map((n) => <option key={n} value={n}>{n} {t('time.planning.weeks')}</option>)}
            </SelectInput>
          </div>
          <WeekNavigator week={from} onChange={setFrom} isoWeek={board.data?.weeks[0]?.isoWeek.week} />
          {canPlan && <Button onClick={() => setDraft(newDraft())}><Plus size={14} />{t('time.planning.allocate')}</Button>}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('time.planning.legend')}</p>

      {board.isLoading ? <Skeleton className="h-64" /> : board.isError ? <p className="text-sm text-destructive">{(board.error as Error).message}</p> : board.data && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="sticky left-0 z-10 min-w-[200px] bg-card px-3 py-2 text-left font-medium">{t('time.employee')}</th>
                  {board.data.weeks.map((w) => (
                    <th key={w.weekStart} className="min-w-[110px] px-2 py-2 text-center font-medium">
                      {t('time.cw', { week: w.isoWeek.week })}<div className="font-normal">{shortDate(w.weekStart, i18n.language)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.data.rows.length === 0 && <tr><td colSpan={weeks + 1} className="px-3 py-8 text-center text-sm text-muted-foreground">{t('time.planning.noEmployees')}</td></tr>}
                {board.data.rows.map((row) => (
                  <tr key={row.employee.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <div className="text-sm font-medium">{row.employee.lastName}, {row.employee.firstName}</div>
                      {row.employee.department && <div className="text-muted-foreground">{row.employee.department}</div>}
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.weekStart} className={clsx('border-l border-border/40 px-2 py-1.5', TONE[utilizationTone(cell.utilization)])}>
                        <button type="button" disabled={!canPlan} onClick={() => setDraft({ ...newDraft(row.employee.id, cell.weekStart), toWeek: cell.weekStart })}
                          className="w-full text-center font-semibold tabular-nums disabled:cursor-default" title={`${t('time.planning.utilization')}: ${cell.utilization ?? '–'} %`}>
                          {hours(cell.plannedMinutes)} / {hours(cell.capacityMinutes)}
                        </button>
                        <div className="text-center text-muted-foreground tabular-nums">{t('time.planning.actual')} {hours(cell.actualMinutes)}</div>
                        {cell.allocations.map((a) => (
                          <div key={a.id} className="mt-1 flex items-center justify-between gap-1 rounded bg-background/70 px-1.5 py-0.5" title={a.projectName ?? a.projectCode}>
                            <span className="truncate">{a.projectCode}</span>
                            <span className="flex items-center gap-0.5 tabular-nums">{hours(a.plannedMinutes)}
                              {hasPermission(me, 'time.planning.delete') && (
                                <button type="button" aria-label={t('common.delete')} className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(a.id)}><X size={11} /></button>
                              )}
                            </span>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {board.data.projects.length > 0 && (
            <section className="mt-6 rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t('time.planning.projects')}</header>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t('time.project')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('time.planning.planned')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('time.planning.actual')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('time.planning.people')}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.data.projects.map((p) => (
                    <tr key={p.projectCode} className="border-t border-border/60">
                      <td className="px-4 py-2"><span className="font-medium">{p.projectCode}</span>{p.projectName && <span className="text-muted-foreground"> · {p.projectName}</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{hours(p.plannedMinutes)} h</td>
                      <td className="px-4 py-2 text-right tabular-nums">{hours(p.actualMinutes)} h</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.employees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      <AllocationDialog draft={draft} onClose={() => setDraft(null)} employees={employees} />
    </div>
  );
}
