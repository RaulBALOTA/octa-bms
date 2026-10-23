import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, UserPlus } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, SelectInput, Skeleton, TextInput, useToast } from '../../components/ui';
import { api, Paged } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { formatMinutes, localDay, parseDuration, shortDate } from './format';
import { TimeNav, useInvalidateTime, useTimeKey } from './shared';
import type { ScheduleAssignment, WorkSchedule } from './types';

const BLANK = { code: '', name: '', days: ['8:00', '8:00', '8:00', '8:00', '8:00', '0:00', '0:00'], coreStart: '', coreEnd: '', isDefault: false, isActive: true };

function ScheduleDialog({ open, schedule, onClose }: { open: boolean; schedule: WorkSchedule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const weekdays = t('time.schedules.weekdays', { returnObjects: true }) as string[];
  const [form, setForm] = useState(BLANK);
  useEffect(() => {
    if (!open) return;
    setForm(schedule ? {
      code: schedule.code, name: schedule.name, days: schedule.dailyMinutes.map((m) => formatMinutes(m)), coreStart: schedule.coreStart ?? '',
      coreEnd: schedule.coreEnd ?? '', isDefault: schedule.isDefault, isActive: schedule.isActive,
    } : BLANK);
  }, [open, schedule]);
  const minutes = form.days.map(parseDuration);
  const valid = minutes.every((m) => m !== null && m <= 600);
  const save = useMutation({
    mutationFn: () => {
      const body = { code: form.code, name: form.name, dailyMinutes: minutes, coreStart: form.coreStart || undefined, coreEnd: form.coreEnd || undefined, isDefault: form.isDefault, isActive: form.isActive };
      return schedule ? api.put(`/time/schedules/${schedule.id}`, body) : api.post('/time/schedules', body);
    },
    onSuccess: () => { void invalidate(); toast(t('common.saved')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Dialog open={open} onClose={onClose} title={schedule ? t('time.schedules.edit') : t('time.schedules.new')} width="max-w-xl">
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('time.schedules.code')} required><TextInput value={form.code} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required /></Field>
          <Field label={t('time.schedules.name')} required className="col-span-2"><TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></Field>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {weekdays.map((label, i) => (
            <Field key={label} label={label}>
              <TextInput value={form.days[i]} aria-invalid={minutes[i] === null} className={minutes[i] === null ? 'border-destructive' : undefined}
                onChange={(e) => setForm((f) => ({ ...f, days: f.days.map((d, j) => (j === i ? e.target.value : d)) }))} />
            </Field>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('time.schedules.weekly')}: {valid ? formatMinutes(minutes.reduce<number>((s, m) => s + (m ?? 0), 0)) : '—'}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('time.schedules.core')} — ${t('time.start')}`}><TextInput type="time" value={form.coreStart} onChange={(e) => setForm((f) => ({ ...f, coreStart: e.target.value }))} /></Field>
          <Field label={`${t('time.schedules.core')} — ${t('time.end')}`}><TextInput type="time" value={form.coreEnd} onChange={(e) => setForm((f) => ({ ...f, coreEnd: e.target.value }))} /></Field>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />{t('time.schedules.default')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />{t('time.schedules.active')}</label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !valid || !form.code || !form.name}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ open, schedules, onClose }: { open: boolean; schedules: WorkSchedule[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const key = useTimeKey();
  const invalidate = useInvalidateTime();
  const [form, setForm] = useState({ employeeId: '', scheduleId: '', validFrom: localDay() });
  const employees = useQuery({
    queryKey: key('employees'),
    queryFn: () => api.get<Paged<{ id: string; firstName: string; lastName: string }>>('/hr/employees?pageSize=200'),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => api.post('/time/schedule-assignments', form),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('time.schedules.assign')}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label={t('time.employee')} required>
          <SelectInput value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} required>
            <option value="">—</option>
            {employees.data?.data.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('time.schedules.title')} required>
          <SelectInput value={form.scheduleId} onChange={(e) => setForm((f) => ({ ...f, scheduleId: e.target.value }))} required>
            <option value="">—</option>
            {schedules.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('time.schedules.validFrom')} required><TextInput type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} required /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !form.employeeId || !form.scheduleId}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SchedulesPage() {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const [editing, setEditing] = useState<{ open: boolean; schedule: WorkSchedule | null }>({ open: false, schedule: null });
  const [assigning, setAssigning] = useState(false);
  const schedules = useQuery({ queryKey: key('schedules'), queryFn: () => api.get<WorkSchedule[]>('/time/schedules') });
  const assignments = useQuery({ queryKey: key('schedule-assignments'), queryFn: () => api.get<ScheduleAssignment[]>('/time/schedule-assignments') });
  const weekdays = t('time.schedules.weekdays', { returnObjects: true }) as string[];

  return (
    <div>
      <TimeNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('time.schedules.title')}</h1>
        <div className="flex gap-2">
          {hasPermission(me, 'time.schedules.update') && <Button variant="secondary" onClick={() => setAssigning(true)}><UserPlus size={14} />{t('time.schedules.assign')}</Button>}
          {hasPermission(me, 'time.schedules.create') && <Button onClick={() => setEditing({ open: true, schedule: null })}><Plus size={14} />{t('time.schedules.new')}</Button>}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('time.schedules.fallbackHint')}</p>
      {schedules.isLoading ? <Skeleton className="h-32" /> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('time.schedules.code')}</th>
                <th className="px-3 py-2 font-medium">{t('time.schedules.name')}</th>
                {weekdays.map((d) => <th key={d} className="px-2 py-2 text-right font-medium">{d}</th>)}
                <th className="px-3 py-2 text-right font-medium">{t('time.schedules.weekly')}</th>
                <th className="px-3 py-2 font-medium">{t('time.schedules.core')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.schedules.inUse')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.data?.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">{t('time.schedules.empty')}</td></tr>}
              {schedules.data?.map((s) => (
                <tr key={s.id} className={`border-b border-border/60 last:border-0 ${s.isActive ? '' : 'text-muted-foreground'}`}>
                  <td className="px-3 py-2 font-medium">{s.code}{s.isDefault && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{t('time.schedules.default')}</span>}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  {s.dailyMinutes.map((m, i) => <td key={i} className="px-2 py-2 text-right tabular-nums">{m ? formatMinutes(m) : '–'}</td>)}
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinutes(s.weeklyMinutes)}</td>
                  <td className="px-3 py-2 tabular-nums">{s.coreStart && s.coreEnd ? `${s.coreStart}–${s.coreEnd}` : '–'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.activeAssignments}</td>
                  <td className="px-3 py-2 text-right">
                    {hasPermission(me, 'time.schedules.update') && <Button size="sm" variant="ghost" aria-label={t('time.schedules.edit')} onClick={() => setEditing({ open: true, schedule: s })}><Pencil size={13} /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">{t('time.schedules.assignments')}</h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t('time.employee')}</th>
              <th className="px-3 py-2 font-medium">{t('time.schedules.title')}</th>
              <th className="px-3 py-2 font-medium">{t('time.schedules.validFrom')}</th>
              <th className="px-3 py-2 font-medium">{t('time.schedules.validTo')}</th>
            </tr>
          </thead>
          <tbody>
            {assignments.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('time.schedules.noAssignments')}</td></tr>}
            {assignments.data?.map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{a.employee.lastName}, {a.employee.firstName}</td>
                <td className="px-3 py-2">{a.schedule.code} — {a.schedule.name}</td>
                <td className="px-3 py-2 tabular-nums">{shortDate(a.validFrom, i18n.language)}.{a.validFrom.slice(0, 4)}</td>
                <td className="px-3 py-2 tabular-nums">{a.validTo ? `${shortDate(a.validTo, i18n.language)}.${a.validTo.slice(0, 4)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ScheduleDialog open={editing.open} schedule={editing.schedule} onClose={() => setEditing({ open: false, schedule: null })} />
      <AssignDialog open={assigning} schedules={schedules.data ?? []} onClose={() => setAssigning(false)} />
    </div>
  );
}
