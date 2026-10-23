import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { Button, Field, SelectInput, TextInput } from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';
import { CalendarDetail } from '../features/company-calendar/CalendarDetail';
import { CalendarEditor } from '../features/company-calendar/CalendarEditor';
import { calendarDays, dateInZone, isoDate, itemDate, occupiesDate } from '../features/company-calendar/dates';
import { useCalendarCapability, useCalendarDetail, useCalendarHorizon, useCalendarItems } from '../features/company-calendar/queries';
import { CalendarItem, SHAPES, STATUSES } from '../features/company-calendar/types';

export function CompanyCalendarPage() {
  const { companyId, me } = useAuthStore();
  const { t } = useTranslation();
  if (!me) return <p role="status">{t('common.loading')}</p>;
  if (!companyId || !hasPermission(me, 'calendar.items.read')) return <p role="alert">{t('calendar.accessRequired')}</p>;
  return <CompanyCalendarWorkspace key={`${companyId}:${me.id}`} />;
}
function CompanyCalendarWorkspace() {
  const { t, i18n } = useTranslation(); const { companyId, me } = useAuthStore();
  const [params, setParams] = useSearchParams(); const capability = useCalendarCapability();
  const view = ['horizon', 'calendar', 'timeline', 'register', 'settings'].includes(params.get('view') ?? '') ? params.get('view') ?? 'horizon' : 'horizon';
  const mode = ['day', 'workweek', 'week', 'month', 'year'].includes(params.get('mode') ?? '') ? params.get('mode') ?? 'month' : 'month';
  const candidateDate = new Date((params.get('date') ?? '') + 'T12:00:00Z');
  const validAnchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') && Number.isFinite(candidateDate.getTime()) && candidateDate.toISOString().slice(0, 10) === params.get('date');
  const anchor = validAnchor ? params.get('date') ?? '' : dateInZone(new Date().toISOString(), 'Europe/Berlin');
  const [editor, setEditor] = useState<CalendarItem | 'new' | null>(null); const [initialDate, setInitialDate] = useState(anchor);
  const [savedName, setSavedName] = useState('');
  const savedKey = `octa-calendar-views:${companyId}:${me?.id}`;
  const [savedViews, setSavedViews] = useState<{ name: string; query: string }[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(savedKey) ?? '[]'); return Array.isArray(saved) ? saved.filter((row): row is { name: string; query: string } => typeof row?.name === 'string' && typeof row?.query === 'string').slice(0, 20) : []; } catch { return []; }
  });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); setParams(next); };
  const base = new URLSearchParams(); for (const key of ['search', 'domain', 'status', 'owner']) { const value = params.get(key); if (value) base.set(key, value); }
  const query = new URLSearchParams(base); const days = calendarDays(anchor, mode);
  const year = Number(anchor.slice(0, 4));
  if (view === 'calendar' || view === 'timeline') {
    query.set('from', mode === 'year' || view === 'timeline' ? `${year}-01-01` : days[0]);
    query.set('to', mode === 'year' || view === 'timeline' ? `${year}-12-31` : days[days.length - 1]);
  }
  query.set('pageSize', '100'); query.set('page', params.get('page') ?? '1');
  const horizonParams = new URLSearchParams(base); horizonParams.delete('status');
  const horizonDays = ['7', '30', '90'].includes(params.get('horizon') ?? '') ? params.get('horizon') ?? '30' : '30';
  const until = new Date(anchor + 'T12:00:00'); until.setDate(until.getDate() + Number(horizonDays)); horizonParams.set('to', isoDate(until));
  const enabled = capability.data?.enabled === true;
  const list = useCalendarItems(query, enabled && ['calendar', 'timeline', 'register'].includes(view));
  const horizon = useCalendarHorizon(horizonParams, enabled && view === 'horizon');
  const selected = params.get('item'); const detail = useCalendarDetail(selected, enabled);
  const items = list.data?.data ?? []; const horizonItems = horizon.data?.items ?? [];
  const open = (item: CalendarItem) => update('item', item.id);
  const newItem = (date = anchor) => { setInitialDate(date); setEditor('new'); };
  const dateLabel = (date: string, options?: Intl.DateTimeFormatOptions) => new Date(date + 'T12:00:00Z').toLocaleDateString(i18n.language, { timeZone: 'UTC', ...options });
  const navigatePeriod = (direction: number) => {
    const date = new Date(anchor + 'T12:00:00');
    if (view === 'timeline' || mode === 'year') date.setFullYear(date.getFullYear() + direction);
    else if (mode === 'month') { date.setDate(1); date.setMonth(date.getMonth() + direction); }
    else date.setDate(date.getDate() + direction * (mode === 'day' ? 1 : 7)); update('date', isoDate(date));
  };
  function row(item: CalendarItem, compact = false) {
    return <button key={item.id} onClick={() => open(item)} className={clsx('w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', item.attention.overdue && 'border-destructive/50')}>
      <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium"><span aria-hidden="true">{SHAPES[item.kind]} </span>{item.title}</span>{item.recurrenceFrequency && <span aria-label={t('calendar.recurrence')}>↻</span>}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t(`calendar.kinds.${item.kind}`)} · {t(`calendar.domains.${item.domain}`)}</p>
      {!compact && <><p className="mt-2 text-xs">{itemDate(item) && dateLabel(itemDate(item))} · {item.owner ? `${item.owner.firstName} ${item.owner.lastName}` : t('calendar.unassigned')}</p><div className="mt-2 flex flex-wrap gap-1"><span className="rounded bg-muted px-2 py-0.5 text-xs">{t(`calendar.statuses.${item.status}`)}</span>{item.attention.overdue && <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{t('calendar.overdue')}</span>}{item.attention.score >= 60 && <span className="rounded bg-warning/10 px-2 py-0.5 text-xs">{t('calendar.critical')}</span>}{item.sensitivity !== 'PUBLIC_INTERNAL' && <span className="rounded bg-muted px-2 py-0.5 text-xs">{t(`calendar.sensitivities.${item.sensitivity}`)}</span>}</div><p className="mt-2 text-xs text-muted-foreground">{item.attention.reasons.slice(0, 3).map((r) => t(`calendar.reasons.${r}`)).join(' · ')}</p></>}
    </button>;
  }
  const error = capability.error ?? list.error ?? horizon.error ?? detail.error;
  return <div className="space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><CalendarDays className="text-primary"/>{t('calendar.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('calendar.subtitle')}</p></div><div className="flex flex-wrap items-center gap-2"><span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"><ShieldCheck size={14}/>{t('calendar.microsoftUnconnectedShort')}</span>{hasPermission(me, 'calendar.items.create') && <Button onClick={() => newItem()} disabled={!enabled}><Plus size={16}/>{t('calendar.create')}</Button>}</div></header>
    {capability.isLoading && <p role="status">{t('common.loading')}</p>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm"><p>{error.message}</p><Button variant="secondary" onClick={() => { void capability.refetch(); if (enabled) { if (view === 'horizon') void horizon.refetch(); else void list.refetch(); } }}>{t('calendar.retry')}</Button></div>}
    {capability.data && !enabled && <p role="status" className="rounded-lg border border-border bg-card p-5">{t('calendar.disabled')}</p>}
    {enabled && <>
      <nav aria-label={t('calendar.views')} className="flex flex-wrap gap-2">{['horizon', 'calendar', 'timeline', 'register', 'settings'].map((key) => <Button key={key} variant={view === key ? 'primary' : 'secondary'} aria-pressed={view === key} onClick={() => update('view', key)}>{t(`calendar.viewsLabel.${key}`)}</Button>)}</nav>
      {view !== 'settings' && <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('common.search')}><TextInput value={params.get('search') ?? ''} onChange={(e) => update('search', e.target.value)} maxLength={250}/></Field>
        <Field label={t('calendar.domain')}><SelectInput value={params.get('domain') ?? ''} onChange={(e) => update('domain', e.target.value)}><option value="">{t('calendar.allDomains')}</option>{capability.data?.domains.map((d) => <option key={d} value={d}>{t(`calendar.domains.${d}`)}</option>)}</SelectInput></Field>
        <Field label={t('common.status')}><SelectInput value={params.get('status') ?? ''} disabled={view === 'horizon'} onChange={(e) => update('status', e.target.value)}><option value="">{t('calendar.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`calendar.statuses.${s}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.owner')}><SelectInput value={params.get('owner') ?? ''} onChange={(e) => update('owner', e.target.value)}><option value="">{t('calendar.allOwners')}</option><option value="me">{t('calendar.myItems')}</option></SelectInput></Field>
        <Field label={t('calendar.savedViews')}><SelectInput value="" onChange={(e) => { if (e.target.value) setParams(new URLSearchParams(e.target.value)); }}><option value="">{t('calendar.selectView')}</option>{savedViews.map((s, i) => <option key={i} value={s.query}>{s.name}</option>)}</SelectInput></Field>
        <div className="flex items-end gap-2 sm:col-span-2"><Field label={t('calendar.viewName')} className="flex-1"><TextInput value={savedName} onChange={(e) => setSavedName(e.target.value)} maxLength={100}/></Field><Button variant="secondary" disabled={!savedName.trim()} onClick={() => { const saved = new URLSearchParams(params); saved.delete('item'); const next = [...savedViews.filter((s) => s.name !== savedName.trim()), { name: savedName.trim(), query: saved.toString() }].slice(-20); localStorage.setItem(savedKey, JSON.stringify(next)); setSavedViews(next); setSavedName(''); }}>{t('calendar.saveView')}</Button></div>
      </div>}
      {view === 'horizon' && <>
        <div className="flex items-center gap-3"><h2 className="text-lg font-semibold">{t('calendar.managementAttention')}</h2><SelectInput aria-label={t('calendar.horizon')} className="!w-auto" value={params.get('horizon') ?? '30'} onChange={(e) => update('horizon', e.target.value)}>{[7, 30, 90].map((d) => <option key={d} value={d}>{t('calendar.nextDays', { count: d })}</option>)}</SelectInput></div>
        {horizon.isLoading && <p role="status">{t('common.loading')}</p>}
        {horizon.data?.truncated && <p role="status" className="text-sm text-warning">{t('calendar.truncatedHorizon')}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{['critical', 'overdue', 'awaiting', 'missingOwner'].map((key) => <div key={key} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{t(`calendar.${key}`)}</p><p className={clsx('mt-2 text-3xl font-semibold', key === 'overdue' && 'text-destructive')}>{horizon.data?.summary[key as keyof typeof horizon.data.summary] ?? 0}</p></div>)}</div>
        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]"><section className="space-y-3" aria-label={t('calendar.managementAttention')}>{horizonItems.length === 0 && !horizon.isLoading && !horizon.error && <EmptyCalendar onCreate={() => newItem()} canCreate={hasPermission(me, 'calendar.items.create')}/>}<div className="grid gap-3 md:grid-cols-2">{horizonItems.slice(0, 24).map((x) => row(x))}</div></section><aside className="space-y-3"><h2 className="font-semibold">{t('calendar.upcomingAgenda')}</h2>{horizonItems.filter((x) => !x.attention.overdue).sort((a, b) => itemDate(a).localeCompare(itemDate(b))).slice(0, 8).map((x) => row(x))}<p className="text-xs text-muted-foreground">{t('calendar.scoreHelp')}</p></aside></div>
      </>}
      {['calendar', 'timeline'].includes(view) && <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" aria-label={t('calendar.previous')} onClick={() => navigatePeriod(-1)}><ChevronLeft size={16}/></Button><Button variant="secondary" onClick={() => update('date', dateInZone(new Date().toISOString(), 'Europe/Berlin'))}>{t('calendar.today')}</Button><Button variant="secondary" aria-label={t('calendar.next')} onClick={() => navigatePeriod(1)}><ChevronRight size={16}/></Button><Field label={t('calendar.period')}><TextInput type="date" value={anchor} onChange={(e) => { if (e.target.value) update('date', e.target.value); }}/></Field>{view === 'calendar' && <SelectInput aria-label={t('calendar.calendarMode')} className="!w-auto" value={mode} onChange={(e) => update('mode', e.target.value)}>{['day', 'workweek', 'week', 'month', 'year'].map((m) => <option key={m} value={m}>{t(`calendar.modes.${m}`)}</option>)}</SelectInput>}</div>}
      {list.isLoading && ['calendar', 'timeline', 'register'].includes(view) && <p role="status">{t('common.loading')}</p>}
      {view === 'calendar' && mode !== 'year' && <div className="overflow-x-auto rounded-xl border border-border"><div className={clsx('grid gap-px bg-border', mode === 'day' ? 'grid-cols-1' : mode === 'workweek' ? 'min-w-[680px] grid-cols-5' : 'min-w-[800px] grid-cols-7')}>
        {days.map((day) => <section key={day} aria-label={dateLabel(day)} className={clsx('min-h-36 space-y-2 bg-card p-2', day.slice(0, 7) !== anchor.slice(0, 7) && mode === 'month' && 'opacity-70')}><div className="flex items-center justify-between"><h3 className="text-xs font-medium">{dateLabel(day, { weekday: 'short', day: 'numeric' })}</h3>{hasPermission(me, 'calendar.items.create') && <button className="rounded p-1 focus-visible:ring-2 focus-visible:ring-primary" aria-label={t('calendar.addOn', { date: dateLabel(day) })} onClick={() => newItem(day)}><Plus size={14}/></button>}</div>{items.filter((x) => occupiesDate(x, day)).map((x) => row(x, true))}</section>)}
      </div></div>}
      {view === 'calendar' && mode === 'year' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 12 }, (_, m) => { const month = `${year}-${String(m + 1).padStart(2, '0')}`; const monthItems = items.filter((x) => itemDate(x).startsWith(month)); return <button key={month} className="rounded-xl border border-border bg-card p-4 text-left focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { const next = new URLSearchParams(params); next.set('mode', 'month'); next.set('date', `${month}-01`); next.delete('page'); setParams(next); }}><h3 className="font-medium">{dateLabel(`${month}-01`, { month: 'long' })}</h3><p className="mt-2 text-xs text-muted-foreground">{t('calendar.itemCount', { count: monthItems.length })}</p>{monthItems.slice(0, 3).map((x) => <p key={x.id} className="mt-2 truncate text-xs">{SHAPES[x.kind]} {x.title}</p>)}</button>; })}</div>}
      {view === 'timeline' && <div className="space-y-4">{capability.data?.domains.map((domain) => <section key={domain} className="rounded-xl border border-border bg-card p-4"><h2 className="mb-3 text-sm font-semibold">{t(`calendar.domains.${domain}`)}</h2><div className="grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((quarter) => <div key={quarter} className="space-y-2 border-l-2 border-primary/30 pl-3"><h3 className="text-xs font-medium text-muted-foreground">{t('calendar.quarter', { quarter, year })}</h3>{items.filter((x) => x.domain === domain && Math.ceil(Number(itemDate(x).slice(5, 7)) / 3) === quarter).map((x) => row(x))}</div>)}</div></section>)}</div>}
      {view === 'register' && <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">{t('calendar.viewsLabel.register')}</caption><thead className="bg-muted text-xs"><tr>{['recordTitle', 'domain', 'owner', 'dateOnly', 'status', 'source'].map((key) => <th key={key} className="p-3">{t(`calendar.${key}`)}</th>)}</tr></thead><tbody>{items.map((x) => <tr key={x.id} className="border-t border-border"><td className="p-3"><button className="text-left font-medium text-primary underline focus-visible:ring-2 focus-visible:ring-primary" onClick={() => open(x)}>{SHAPES[x.kind]} {x.title}</button><p className="text-xs text-muted-foreground">{t(`calendar.kinds.${x.kind}`)}</p></td><td className="p-3">{t(`calendar.domains.${x.domain}`)}</td><td className="p-3">{x.owner ? `${x.owner.firstName} ${x.owner.lastName}` : t('calendar.unassigned')}</td><td className="whitespace-nowrap p-3">{itemDate(x) && dateLabel(itemDate(x))}</td><td className="p-3">{t(`calendar.statuses.${x.status}`)}{x.attention.overdue && <p className="text-xs text-destructive">{t('calendar.overdue')}</p>}</td><td className="p-3">{t(`calendar.sources.${x.sourceKind}`)}</td></tr>)}</tbody></table>{!items.length && !list.isLoading && !list.error && <EmptyCalendar onCreate={() => newItem()} canCreate={hasPermission(me, 'calendar.items.create')}/>}</div>}
      {list.data && ['calendar', 'timeline', 'register'].includes(view) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p>{t('calendar.totalItems', { count: list.data.meta.total })}{list.data.meta.totalPages > 1 && <span> · {t('calendar.pageHelp')}</span>}</p><div className="flex gap-2"><Button variant="secondary" disabled={list.data.meta.page <= 1} onClick={() => update('page', String(list.data.meta.page - 1))}>{t('calendar.previous')}</Button><span className="self-center">{list.data.meta.page} / {Math.max(1, list.data.meta.totalPages)}</span><Button variant="secondary" disabled={list.data.meta.page >= list.data.meta.totalPages} onClick={() => update('page', String(list.data.meta.page + 1))}>{t('calendar.next')}</Button></div></div>}
      {view === 'settings' && <div className="grid gap-4 md:grid-cols-2">{['microsoft', 'ai', 'teams', 'rules'].map((integration) => <section key={integration} className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">{t(`calendar.integrations.${integration}.title`)}</h2><p className="mt-2 text-sm text-muted-foreground">{t(`calendar.integrations.${integration}.description`)}</p><p className="mt-3 text-xs">{t('calendar.unconnected')}</p></section>)}</div>}
    </>}
    {detail.data && selected && !editor && <CalendarDetail item={detail.data} onClose={() => update('item', '')} onEdit={() => setEditor(detail.data)}/>}
    {editor && <CalendarEditor key={editor === 'new' ? 'new' : editor.id} item={editor === 'new' ? undefined : editor} domains={capability.data?.domains ?? []} entityTypes={capability.data?.entityTypes ?? []} initialDate={initialDate} onClose={() => { setEditor(null); if (selected) void detail.refetch(); }}/>} 
  </div>;
}
function EmptyCalendar({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  const { t } = useTranslation(); return <div className="rounded-xl border border-dashed border-border p-8 text-center"><CalendarDays className="mx-auto mb-3 text-muted-foreground"/><p className="font-medium">{t('calendar.empty')}</p><p className="mt-2 text-sm text-muted-foreground">{t('calendar.emptyHelp')}</p>{canCreate && <Button className="mt-4" onClick={onCreate}>{t('calendar.create')}</Button>}</div>;
}
