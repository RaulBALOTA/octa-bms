import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../../components/SubNav';
import { Button, SelectInput } from '../../components/ui';
import { api, Paged } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { addDays, localDay, shortDate, weekStartOf } from './format';
import type { ProjectOption, TimesheetRow, Violation } from './types';

export function useTimeKey() {
  const companyId = useAuthStore((s) => s.companyId);
  return (...parts: unknown[]) => ['time', companyId, ...parts];
}

export function useInvalidateTime() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['time'] });
}

export function TimeNav() {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const canApprove = hasPermission(me, 'time.timesheets.approve');
  const pending = useQuery({
    queryKey: key('timesheets', 'SUBMITTED'),
    queryFn: () => api.get<TimesheetRow[]>('/time/timesheets?status=SUBMITTED'),
    enabled: canApprove,
  });
  return (
    <SubNav
      items={[
        { label: t('time.nav.my'), to: '/time' },
        ...(canApprove ? [{ label: t('time.nav.team'), to: '/time/team', badge: pending.data?.length }] : []),
        ...(hasPermission(me, 'time.planning.read') ? [{ label: t('time.nav.planning'), to: '/time/planning' }] : []),
        ...(hasPermission(me, 'time.schedules.read') ? [{ label: t('time.nav.schedules'), to: '/time/schedules' }] : []),
        ...(hasPermission(me, 'time.integration.read') ? [{ label: t('time.nav.pmo'), to: '/time/pmo' }] : []),
      ]}
    />
  );
}

export function WeekNavigator({ week, onChange, isoWeek }: { week: string; onChange: (week: string) => void; isoWeek?: number }) {
  const { t, i18n } = useTranslation();
  const start = weekStartOf(week);
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="sm" aria-label={t('time.previousWeek')} onClick={() => onChange(addDays(start, -7))}><ChevronLeft size={14} /></Button>
      <div className="min-w-[170px] text-center text-sm">
        {isoWeek !== undefined && <span className="mr-1.5 font-semibold">{t('time.cw', { week: isoWeek })}</span>}
        <span className="text-muted-foreground">{shortDate(start, i18n.language)} – {shortDate(addDays(start, 6), i18n.language)}</span>
      </div>
      <Button variant="secondary" size="sm" aria-label={t('time.nextWeek')} onClick={() => onChange(addDays(start, 7))}><ChevronRight size={14} /></Button>
      <Button variant="ghost" size="sm" onClick={() => onChange(weekStartOf(localDay()))}>{t('time.thisWeek')}</Button>
    </div>
  );
}

/** Employee picker for time managers (requires hr.employees.read for the list). */
export function EmployeePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const enabled = hasPermission(me, 'hr.employees.read');
  const employees = useQuery({
    queryKey: key('employees'),
    queryFn: () => api.get<Paged<{ id: string; firstName: string; lastName: string }>>('/hr/employees?pageSize=200'),
    enabled,
  });
  if (!enabled) return null;
  return (
    <div className="w-56">
      <SelectInput value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('time.employee')}>
        <option value="">{me ? `${me.lastName}, ${me.firstName}` : '—'}</option>
        {employees.data?.data.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>)}
      </SelectInput>
    </div>
  );
}

export function useProjects() {
  const key = useTimeKey();
  return useQuery({ queryKey: key('projects'), queryFn: () => api.get<ProjectOption[]>('/time/projects'), staleTime: 300_000 });
}

export function StatPill({ label, value, tone = 'default', hint }: { label: string; value: string; tone?: 'default' | 'good' | 'bad'; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function ViolationList({ violations }: { violations: Violation[] }) {
  const { t, i18n } = useTranslation();
  if (!violations.length) return null;
  return (
    <ul className="space-y-1">
      {violations.map((v, i) => (
        <li key={`${v.day}-${v.code}-${i}`} className={clsx('flex items-start gap-2 text-sm', v.severity === 'error' ? 'text-destructive' : 'text-warning')}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><span className="font-medium">{shortDate(v.day, i18n.language)}</span> · {t(`time.violation.${v.code}`, { value: v.value, limit: v.limit })}</span>
        </li>
      ))}
    </ul>
  );
}

export function TimesheetBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = { DRAFT: 'bg-muted text-muted-foreground', SUBMITTED: 'bg-warning/15 text-warning', APPROVED: 'bg-success/15 text-success', REJECTED: 'bg-destructive/15 text-destructive' }[status] ?? 'bg-muted text-muted-foreground';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{t(`time.status.${status}`)}</span>;
}

export async function downloadCsv(path: string, filename: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
