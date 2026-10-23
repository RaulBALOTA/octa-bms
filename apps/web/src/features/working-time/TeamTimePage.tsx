import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Download, RotateCcw, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, SelectInput, Skeleton, TextArea, TextInput, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { addDays, formatMinutes, formatSigned, localDay, shortDate, weekStartOf } from './format';
import { TimeNav, TimesheetBadge, ViolationList, WeekNavigator, downloadCsv, useInvalidateTime, useTimeKey } from './shared';
import type { TeamRow, TimesheetRow } from './types';

interface TeamView { weekStart: string; weekEnd: string; isoWeek: { week: number }; rows: TeamRow[] }

function RejectDialog({ sheet, onClose }: { sheet: TimesheetRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidateTime();
  const [note, setNote] = useState('');
  const reject = useMutation({
    mutationFn: () => api.post(`/time/timesheets/${sheet!.id}/decide`, { decision: 'REJECTED', note }),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); setNote(''); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Dialog open={!!sheet} onClose={onClose} title={t('time.reject')}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); reject.mutate(); }}>
        <Field label={t('time.rejectReason')} required><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" disabled={!note.trim() || reject.isPending}>{t('time.reject')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TeamTimePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const invalidate = useInvalidateTime();
  const [week, setWeek] = useState(() => addDays(weekStartOf(localDay()), -7));
  const [departmentId, setDepartmentId] = useState('');
  const [rejecting, setRejecting] = useState<TimesheetRow | null>(null);
  const [exportRange, setExportRange] = useState(() => ({ from: `${localDay().slice(0, 7)}-01`, to: localDay() }));

  const pending = useQuery({ queryKey: key('timesheets', 'SUBMITTED'), queryFn: () => api.get<TimesheetRow[]>('/time/timesheets?status=SUBMITTED') });
  const team = useQuery({
    queryKey: key('team', week, departmentId),
    queryFn: () => api.get<TeamView>(`/time/team?week=${week}${departmentId ? `&departmentId=${departmentId}` : ''}`),
  });
  const departments = useQuery({
    queryKey: key('departments'),
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/departments'),
    retry: false,
  });
  const departmentList = departments.data ?? [];

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reopen' }) => action === 'approve'
      ? api.post(`/time/timesheets/${id}/decide`, { decision: 'APPROVED' })
      : api.post(`/time/timesheets/${id}/reopen`),
    onSuccess: () => { void invalidate(); toast(t('common.saved')); },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <div>
      <TimeNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('time.nav.team')}</h1>
        {hasPermission(me, 'time.timesheets.export') && (
          <div className="flex items-end gap-2">
            <Field label={t('time.from')}><TextInput type="date" value={exportRange.from} onChange={(e) => setExportRange((r) => ({ ...r, from: e.target.value }))} /></Field>
            <Field label={t('time.to')}><TextInput type="date" value={exportRange.to} onChange={(e) => setExportRange((r) => ({ ...r, to: e.target.value }))} /></Field>
            <Button variant="secondary" onClick={() => void downloadCsv(`/time/export.csv?from=${exportRange.from}&to=${exportRange.to}`, `working-time-${exportRange.from}-${exportRange.to}.csv`).catch((e: Error) => toast(e.message, 'error'))}>
              <Download size={14} />{t('time.exportCsv')}
            </Button>
          </div>
        )}
      </div>

      <section className="mb-6 rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t('time.pending')} ({pending.data?.length ?? 0})</header>
        {pending.isLoading ? <Skeleton className="m-4 h-16" /> : !pending.data?.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">—</p> : (
          <ul className="divide-y divide-border/60">
            {pending.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="w-48 font-medium">{s.employee.lastName}, {s.employee.firstName}</span>
                <span className="w-40 text-muted-foreground">{t('time.cw', { week: s.isoWeek.week })} · {shortDate(s.weekStart, i18n.language)}</span>
                <span className="tabular-nums">{t('time.worked')} {formatMinutes(s.workedMinutes)} / {formatMinutes(s.targetMinutes)}</span>
                <span className={clsx('tabular-nums', s.workedMinutes - s.targetMinutes < 0 ? 'text-destructive' : 'text-success')}>{formatSigned(s.workedMinutes - s.targetMinutes)}</span>
                <span className="tabular-nums text-muted-foreground">{t('time.projects')} {formatMinutes(s.projectMinutes)}</span>
                <span className="flex-1">{s.violations?.length ? <ViolationList violations={s.violations} /> : null}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: s.id, action: 'approve' })} disabled={act.isPending}><Check size={13} className="text-success" />{t('time.approve')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(s)}><X size={13} className="text-destructive" />{t('time.reject')}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('time.teamWeek')}</h2>
        <div className="flex items-center gap-2">
          {departmentList.length > 0 && (
            <div className="w-52">
              <SelectInput value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label={t('time.allDepartments')}>
                <option value="">{t('time.allDepartments')}</option>
                {departmentList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectInput>
            </div>
          )}
          <WeekNavigator week={week} onChange={setWeek} isoWeek={team.data?.isoWeek.week} />
        </div>
      </div>
      {team.isLoading ? <Skeleton className="h-48" /> : team.isError ? <p className="text-sm text-destructive">{(team.error as Error).message}</p> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('time.employee')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.target')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.worked')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.delta')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.projects')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.unallocated')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('time.violations')}</th>
                <th className="px-3 py-2 font-medium">{t('time.timesheet')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.data?.rows.map((r) => {
                const unallocated = r.totals.workedMinutes - r.totals.projectMinutes;
                return (
                  <tr key={r.employee.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.employee.lastName}, {r.employee.firstName}</div>
                      <div className="text-xs text-muted-foreground">{r.employee.employeeNumber}{r.employee.department ? ` · ${r.employee.department}` : ''}{r.absenceDays ? ` · ${r.absenceDays}d ${t('time.absence.VACATION')}/${t('time.absence.SICK')}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(r.totals.targetMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(r.totals.workedMinutes)}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', r.totals.deltaMinutes < 0 ? 'text-destructive' : r.totals.deltaMinutes > 0 && 'text-success')}>{formatSigned(r.totals.deltaMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(r.totals.projectMinutes)}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', unallocated !== 0 && 'text-warning')}>{formatSigned(unallocated)}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', r.errors ? 'text-destructive' : r.violations ? 'text-warning' : 'text-muted-foreground')}>{r.violations || '–'}</td>
                    <td className="px-3 py-2"><TimesheetBadge status={r.timesheet.status} /></td>
                    <td className="px-3 py-2 text-right">
                      {r.timesheet.id && ['SUBMITTED', 'APPROVED'].includes(r.timesheet.status) && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.timesheet.id!, action: 'reopen' })} disabled={act.isPending}><RotateCcw size={13} />{t('time.reopen')}</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <RejectDialog sheet={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}
