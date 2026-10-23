import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, LogIn, LogOut, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, SelectInput, Skeleton, TextArea, TextInput, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { formatMinutes, formatSigned, localDay, shortDate, weekdayLabel, weekStartOf } from './format';
import {
  EmployeePicker, StatPill, TimeNav, TimesheetBadge, ViolationList, WeekNavigator, downloadCsv, useInvalidateTime, useProjects, useTimeKey,
} from './shared';
import type { Balance, ProjectEntry, RecordKind, TimeRecord, WeekView } from './types';

const KINDS: RecordKind[] = ['OFFICE', 'HOME_OFFICE', 'ON_SITE', 'BUSINESS_TRIP'];

function RecordDialog({ open, onClose, employeeId, record, defaultDate }: {
  open: boolean; onClose: () => void; employeeId?: string; record: TimeRecord | null; defaultDate: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const [form, setForm] = useState({ date: defaultDate, startTime: '08:00', endTime: '16:30', breakMinutes: '30', kind: 'OFFICE' as RecordKind, note: '' });
  useEffect(() => {
    if (!open) return;
    setForm(record
      ? { date: record.date, startTime: record.startTime, endTime: record.endTime ?? '', breakMinutes: String(record.breakMinutes), kind: record.kind, note: record.note ?? '' }
      : { date: defaultDate, startTime: '08:00', endTime: '16:30', breakMinutes: '30', kind: 'OFFICE', note: '' });
  }, [open, record, defaultDate]);
  const save = useMutation({
    mutationFn: () => {
      const body = { employeeId, date: form.date, startTime: form.startTime, endTime: form.endTime || undefined, breakMinutes: Number(form.breakMinutes) || 0, kind: form.kind, note: form.note || undefined };
      return record ? api.put(`/time/records/${record.id}`, body) : api.post('/time/records', body);
    },
    onSuccess: () => { void invalidate(); toast(t('common.saved')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onClose={onClose} title={record ? t('time.editRecord') : t('time.addRecord')}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('time.date')} required><TextInput type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required /></Field>
          <Field label={t('time.kind')}>
            <SelectInput value={form.kind} onChange={(e) => set({ kind: e.target.value as RecordKind })}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`time.kinds.${k}`)}</option>)}
            </SelectInput>
          </Field>
          <Field label={t('time.start')} required><TextInput type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} required /></Field>
          <Field label={t('time.end')}><TextInput type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
          <Field label={t('time.breakMinutes')}><TextInput type="number" min={0} max={600} step={5} value={form.breakMinutes} onChange={(e) => set({ breakMinutes: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('time.endHint')}</p>
        <Field label={t('time.note')}><TextArea rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !form.date || !form.startTime}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EntryDialog({ open, onClose, employeeId, entry, defaultDate }: {
  open: boolean; onClose: () => void; employeeId?: string; entry: ProjectEntry | null; defaultDate: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const projects = useProjects();
  const blank = { date: defaultDate, projectCode: '', customCode: '', projectName: '', taskRef: '', hours: '', billable: true, description: '' };
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setForm(entry
      ? { date: entry.date, projectCode: entry.projectCode, customCode: '', projectName: entry.projectName ?? '', taskRef: entry.taskRef ?? '', hours: String(entry.hours), billable: entry.billable, description: entry.description ?? '' }
      : { ...blank, date: defaultDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultDate]);
  const options = projects.data?.filter((p) => p.isActive || p.code === form.projectCode) ?? [];
  const known = options.some((p) => p.code === form.projectCode);
  const custom = form.projectCode === '__other' || (!!form.projectCode && !known && !projects.isLoading);
  const code = custom ? (form.projectCode === '__other' ? form.customCode : form.projectCode) : form.projectCode;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeId, date: form.date, projectCode: code.trim(), projectName: custom ? form.projectName || undefined : undefined,
        taskRef: form.taskRef || undefined, hours: Number(form.hours.replace(',', '.')), billable: form.billable, description: form.description || undefined,
      };
      return entry ? api.put(`/time/entries/${entry.id}`, body) : api.post('/time/entries', body);
    },
    onSuccess: () => { void invalidate(); toast(t('common.saved')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onClose={onClose} title={entry ? t('time.editEntry') : t('time.addEntry')}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('time.date')} required><TextInput type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required /></Field>
          <Field label={t('time.hours')} required><TextInput inputMode="decimal" placeholder="7.5" value={form.hours} onChange={(e) => set({ hours: e.target.value })} required /></Field>
          <Field label={t('time.project')} required className="col-span-2">
            <SelectInput value={custom && form.projectCode !== '__other' ? '__other' : form.projectCode} onChange={(e) => set({ projectCode: e.target.value, customCode: '' })} required>
              <option value="">{t('time.chooseProject')}</option>
              {options.map((p) => <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''}</option>)}
              <option value="__other">{t('time.otherProject')}</option>
            </SelectInput>
          </Field>
          {custom && (
            <>
              <Field label={t('time.projectCode')} required>
                <TextInput value={form.projectCode === '__other' ? form.customCode : form.projectCode} onChange={(e) => set(form.projectCode === '__other' ? { customCode: e.target.value } : { projectCode: e.target.value })} required />
              </Field>
              <Field label={t('time.projectName')}><TextInput value={form.projectName} onChange={(e) => set({ projectName: e.target.value })} /></Field>
            </>
          )}
          <Field label={t('time.task')} className="col-span-2"><TextInput value={form.taskRef} onChange={(e) => set({ taskRef: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.billable} onChange={(e) => set({ billable: e.target.checked })} />{t('time.billable')}</label>
        <Field label={t('time.description')}><TextArea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !code.trim() || !form.hours}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ClockCard({ view, employeeId, locked }: { view: WeekView; employeeId?: string; locked: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [kind, setKind] = useState<RecordKind>('OFFICE');
  const open = view.openRecord;
  const clock = useMutation({
    mutationFn: () => open
      ? api.post('/time/clock-out', { employeeId, breakMinutes: Number(breakMinutes) || 0 })
      : api.post('/time/clock-in', { employeeId, kind }),
    onSuccess: () => { void invalidate(); setBreakMinutes('0'); toast(t('common.saved')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('time.attendance')}</div>
      <div className={clsx('mt-1 text-sm font-medium', open ? 'text-success' : 'text-muted-foreground')}>
        {open ? t('time.clockedInSince', { time: open.startTime }) : t('time.notClockedIn')}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {open ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('time.break')}
            <span className="w-16"><TextInput aria-label={t('time.breakMinutes')} type="number" min={0} max={600} step={5} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} /></span>
            min
          </label>
        ) : (
          <span className="w-36">
            <SelectInput aria-label={t('time.kind')} value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`time.kinds.${k}`)}</option>)}
            </SelectInput>
          </span>
        )}
        <Button onClick={() => clock.mutate()} disabled={clock.isPending || (!open && locked)} variant={open ? 'destructive' : 'primary'}>
          {open ? <LogOut size={14} /> : <LogIn size={14} />}{open ? t('time.clockOut') : t('time.clockIn')}
        </Button>
      </div>
    </div>
  );
}

export function MyTimePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const invalidate = useInvalidateTime();
  const [week, setWeek] = useState(() => weekStartOf(localDay()));
  const [employeeId, setEmployeeId] = useState('');
  const [recordDialog, setRecordDialog] = useState<{ open: boolean; record: TimeRecord | null }>({ open: false, record: null });
  const [entryDialog, setEntryDialog] = useState<{ open: boolean; entry: ProjectEntry | null }>({ open: false, entry: null });
  const [selectedDay, setSelectedDay] = useState(localDay());
  const scope = employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : '';

  const view = useQuery({ queryKey: key('week', week, employeeId), queryFn: () => api.get<WeekView>(`/time/week?week=${week}${scope}`), retry: false });
  const balance = useQuery({ queryKey: key('balance', employeeId), queryFn: () => api.get<Balance>(`/time/balance?${scope.slice(1)}`), enabled: view.isSuccess });

  useEffect(() => {
    if (!view.data) return;
    const inWeek = selectedDay >= view.data.weekStart && selectedDay <= view.data.weekEnd;
    if (!inWeek) setSelectedDay(view.data.today >= view.data.weekStart && view.data.today <= view.data.weekEnd ? view.data.today : view.data.weekStart);
  }, [view.data, selectedDay]);

  const transition = useMutation({
    mutationFn: (action: 'submit' | 'withdraw') => action === 'submit'
      ? api.post('/time/timesheets/submit', { week, employeeId: employeeId || undefined })
      : api.post(`/time/timesheets/${view.data?.timesheet.id}/withdraw`),
    onSuccess: (_d, action) => { void invalidate(); toast(action === 'submit' ? t('time.submitted') : t('common.saved')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: 'records' | 'entries'; id: string }) => api.delete(`/time/${kind}/${id}`),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const confirmRemove = (kind: 'records' | 'entries', id: string) => { if (window.confirm(t('time.deleteConfirm'))) remove.mutate({ kind, id }); };

  const data = view.data;
  const locked = data ? ['SUBMITTED', 'APPROVED'].includes(data.timesheet.status) : false;
  const canEdit = !locked && hasPermission(me, 'time.records.create');
  const recordsByDay = useMemo(() => {
    const map = new Map<string, TimeRecord[]>();
    for (const r of data?.records ?? []) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return map;
  }, [data]);
  const noEmployee = view.error instanceof ApiError && view.error.status === 404 && !employeeId;

  return (
    <div>
      <TimeNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('time.title')}</h1>
          {data && <span className="text-sm text-muted-foreground">{data.employee.lastName}, {data.employee.firstName}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission(me, 'time.timesheets.approve') && <EmployeePicker value={employeeId} onChange={setEmployeeId} />}
          <WeekNavigator week={week} onChange={setWeek} isoWeek={data?.isoWeek.week} />
          {hasPermission(me, 'time.timesheets.export') && data && (
            <Button variant="secondary" size="sm" onClick={() => void downloadCsv(`/time/export.csv?from=${data.weekStart}&to=${data.weekEnd}&employeeId=${data.employee.id}`, `working-time-${data.weekStart}.csv`).catch((e: Error) => toast(e.message, 'error'))}>
              <Download size={13} />{t('time.exportCsv')}
            </Button>
          )}
        </div>
      </div>

      {noEmployee && <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">{t('time.noEmployee')}</div>}
      {view.isError && !noEmployee && <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{(view.error as Error).message}</div>}
      {view.isLoading && <Skeleton className="h-64" />}

      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <ClockCard view={data} employeeId={employeeId || undefined} locked={locked} />
            <StatPill label={`${t('time.worked')} / ${t('time.target')}`} value={`${formatMinutes(data.summary.totals.workedMinutes)} / ${formatMinutes(data.summary.totals.targetMinutes)}`} />
            <StatPill label={t('time.delta')} value={formatSigned(data.summary.totals.deltaMinutes)} tone={data.summary.totals.deltaMinutes < 0 ? 'bad' : 'good'} />
            <StatPill label={t('time.balance')} value={balance.data ? formatSigned(balance.data.balanceMinutes) : '…'} tone={(balance.data?.balanceMinutes ?? 0) < 0 ? 'bad' : 'good'}
              hint={balance.data ? t('time.balanceHint', { from: shortDate(balance.data.from, i18n.language) }) : undefined} />
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('time.timesheet')}<TimesheetBadge status={data.timesheet.status} /></div>
              <div className="mt-2 flex gap-2">
                {!locked && <Button size="sm" onClick={() => transition.mutate('submit')} disabled={transition.isPending || data.weekStart > data.today}><Send size={13} />{t('time.submit')}</Button>}
                {data.timesheet.status === 'SUBMITTED' && <Button size="sm" variant="secondary" onClick={() => transition.mutate('withdraw')} disabled={transition.isPending}><Undo2 size={13} />{t('time.withdraw')}</Button>}
              </div>
              {data.timesheet.status === 'REJECTED' && data.timesheet.decisionNote && <p className="mt-1.5 text-xs text-destructive">{t('time.rejectedHint', { note: data.timesheet.decisionNote })}</p>}
            </div>
          </div>
          {locked && <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('time.lockedHint', { status: t(`time.status.${data.timesheet.status}`) })}</div>}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('time.day')}</th>
                  <th className="px-3 py-2 font-medium">{t('time.attendance')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('time.target')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('time.worked')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('time.break')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('time.projects')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('time.delta')}</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.days.map((d) => (
                  <tr key={d.day} onClick={() => setSelectedDay(d.day)}
                    className={clsx('cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40', d.day === selectedDay && 'bg-primary/5', d.day === data.today && 'font-medium')}>
                    <td className="whitespace-nowrap px-3 py-2">
                      {weekdayLabel(d.day, i18n.language)} {shortDate(d.day, i18n.language)}
                      {d.holiday && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{d.holiday}</span>}
                      {d.absence && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t(`time.absence.${d.absence}`)}</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {(recordsByDay.get(d.day) ?? []).map((r) => `${r.startTime}–${r.endTime ?? '…'}`).join(', ')}
                      {d.violations.length > 0 && <span className={clsx('ml-2 text-xs', d.violations.some((v) => v.severity === 'error') ? 'text-destructive' : 'text-warning')}>⚠ {d.violations.length}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(d.targetMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.workedMinutes || d.open ? formatMinutes(d.workedMinutes) : '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{d.breakMinutes ? formatMinutes(d.breakMinutes) : '–'}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', d.workedMinutes > 0 && d.unallocatedMinutes !== 0 && 'text-warning')} title={d.unallocatedMinutes ? `${t('time.unallocated')}: ${formatMinutes(d.unallocatedMinutes)}` : undefined}>
                      {d.projectMinutes ? formatMinutes(d.projectMinutes) : '–'}
                    </td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', d.deltaMinutes < 0 ? 'text-destructive' : d.deltaMinutes > 0 ? 'text-success' : 'text-muted-foreground')}>
                      {d.targetMinutes || d.workedMinutes ? formatSigned(d.deltaMinutes) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>{t('time.total')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(data.summary.totals.targetMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(data.summary.totals.workedMinutes)}</td>
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(data.summary.totals.projectMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSigned(data.summary.totals.deltaMinutes)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {data.summary.violations.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">{t('time.violations')}</h2>
              <ViolationList violations={data.summary.violations} />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold">{t('time.attendance')}</h2>
                {canEdit && <Button size="sm" variant="secondary" onClick={() => setRecordDialog({ open: true, record: null })}><Plus size={13} />{t('time.addRecord')}</Button>}
              </header>
              {data.records.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('time.noRecords')}</p> : (
                <ul className="divide-y divide-border/60">
                  {data.records.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-24 text-muted-foreground">{weekdayLabel(r.date, i18n.language)} {shortDate(r.date, i18n.language)}</span>
                      <span className="tabular-nums">{r.startTime}–{r.endTime ?? '…'}</span>
                      {r.breakMinutes > 0 && <span className="text-xs text-muted-foreground">−{r.breakMinutes} min</span>}
                      <span className="text-xs text-muted-foreground">{t(`time.kinds.${r.kind}`)}</span>
                      <span className="flex-1 truncate text-xs text-muted-foreground">{r.note}</span>
                      {canEdit && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="ghost" aria-label={t('time.editRecord')} onClick={() => setRecordDialog({ open: true, record: r })}><Pencil size={13} /></Button>
                          <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => confirmRemove('records', r.id)}><Trash2 size={13} /></Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold">{t('time.projectHours')}</h2>
                {canEdit && <Button size="sm" variant="secondary" onClick={() => setEntryDialog({ open: true, entry: null })}><Plus size={13} />{t('time.addEntry')}</Button>}
              </header>
              {data.entries.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('time.noEntries')}</p> : (
                <ul className="divide-y divide-border/60">
                  {data.entries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-24 text-muted-foreground">{weekdayLabel(e.date, i18n.language)} {shortDate(e.date, i18n.language)}</span>
                      <span className="w-12 text-right tabular-nums">{formatMinutes(e.minutes)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{e.projectCode}</span>
                        {e.projectName && <span className="text-muted-foreground"> · {e.projectName}</span>}
                        {e.taskRef && <span className="text-xs text-muted-foreground"> · {e.taskRef}</span>}
                      </span>
                      {!e.billable && <span className="text-[11px] text-muted-foreground">n.b.</span>}
                      {e.source === 'PMO'
                        ? <span title={t('time.pmoReadOnly')} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{t('time.fromPmo')}</span>
                        : canEdit && (
                          <span className="flex gap-1">
                            <Button size="sm" variant="ghost" aria-label={t('time.editEntry')} onClick={() => setEntryDialog({ open: true, entry: e })}><Pencil size={13} /></Button>
                            <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => confirmRemove('entries', e.id)}><Trash2 size={13} /></Button>
                          </span>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      <RecordDialog open={recordDialog.open} record={recordDialog.record} onClose={() => setRecordDialog({ open: false, record: null })}
        employeeId={employeeId || undefined} defaultDate={selectedDay > (data?.today ?? selectedDay) ? data!.today : selectedDay} />
      <EntryDialog open={entryDialog.open} entry={entryDialog.entry} onClose={() => setEntryDialog({ open: false, entry: null })}
        employeeId={employeeId || undefined} defaultDate={selectedDay > (data?.today ?? selectedDay) ? data!.today : selectedDay} />
    </div>
  );
}

