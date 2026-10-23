import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';
import type { StaffingBudgetContext, StaffingBudgetInput, StaffingBudgetLineInput, StaffingBudgetResult, StaffingBudgetScenario } from '../../../../packages/shared/src/staffing-budget';
import { HrNav } from '../components/HrNav';
import { Button, Field, SelectInput, Skeleton, TextArea, TextInput, useToast } from '../components/ui';
import { api } from '../lib/api';
import { newStaffingPlan, shiftStaffingDate, staffingBudgetCsv, staffingDefaults } from '../lib/staffing-budget';
import { hasPermission, useAuthStore } from '../stores/auth';

type Draft = Omit<StaffingBudgetInput, 'lines'> & { lines: (StaffingBudgetLineInput & { included: boolean })[] };
type Meta = StaffingBudgetContext['positions'][number];
const draftOf = (plan: StaffingBudgetInput): Draft => ({ ...plan, lines: plan.lines.map((line) => ({ ...line, included: true })) });

function StaffingBudgetWorkspace({ companyId }: { companyId: string | null }) {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((state) => state.me);
  const canRead = hasPermission(me, 'finance.budgets.read');
  const toast = useToast();
  const client = useQueryClient();
  const context = useQuery({ queryKey: ['staffing-context', companyId], enabled: canRead,
    queryFn: () => api.get<StaffingBudgetContext>('/hr/staffing-budgets/context') });
  const saved = useQuery({ queryKey: ['staffing-budgets', companyId], enabled: canRead,
    queryFn: () => api.get<Pick<StaffingBudgetScenario, 'id' | 'title' | 'year' | 'version'>[]>('/hr/staffing-budgets') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [metadata, setMetadata] = useState<Record<string, Meta>>({});
  const [scenario, setScenario] = useState<StaffingBudgetScenario | null>(null);
  const [revision, setRevision] = useState('');
  const [result, setResult] = useState<StaffingBudgetResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const apply = (plan: StaffingBudgetInput, calculated: StaffingBudgetResult) => {
    setDraft(draftOf(plan)); setResult(calculated);
    setMetadata(Object.fromEntries(calculated.rows.map((row) => [row.positionId, { id: row.positionId, name: row.name, code: row.code, status: row.status, department: row.department }])));
  };
  useEffect(() => {
    if (context.data && !draft) {
      setDraft(draftOf(newStaffingPlan(context.data)));
      setMetadata(Object.fromEntries(context.data.positions.map((position) => [position.id, position])));
    }
  }, [context.data, draft]);
  const load = useMutation({ mutationFn: (id: string) => api.get<StaffingBudgetScenario>(`/hr/staffing-budgets/${encodeURIComponent(id)}`),
    onSuccess: (data) => { setScenario(data); setRevision(''); apply(data.plan, data.result); }, onError: (error: Error) => toast(error.message, 'error') });
  const loadRevision = useMutation({ mutationFn: (version: string) => api.get<{ plan: StaffingBudgetInput; result: StaffingBudgetResult }>(`/hr/staffing-budgets/${scenario!.id}/revisions/${version}`),
    onSuccess: (data, version) => { setRevision(version); apply(data.plan, data.result); }, onError: (error: Error) => toast(error.message, 'error') });
  const payload = useMemo<StaffingBudgetInput | null>(() => draft ? ({
    title: draft.title, year: draft.year, includeOpen: draft.includeOpen, includeBudgeted: draft.includeBudgeted, note: draft.note,
    lines: draft.lines.filter((line) => line.included && (metadata[line.positionId]?.status === 'OPEN' ? draft.includeOpen : draft.includeBudgeted))
      .map(({ included: _included, ...line }) => line),
    expectedVersion: scenario?.version,
  }) : null, [draft, metadata, scenario]);
  const calculate = useMutation({ mutationFn: () => api.post<{ result: StaffingBudgetResult }>('/hr/staffing-budgets/calculate', payload),
    onSuccess: (data) => setResult(data.result) });
  const save = useMutation({ mutationFn: (asNew: boolean) => scenario && !asNew
    ? api.put<StaffingBudgetScenario>(`/hr/staffing-budgets/${scenario.id}`, payload) : api.post<StaffingBudgetScenario>('/hr/staffing-budgets', payload),
    onSuccess: async (data) => {
      setScenario(data); setRevision(''); apply(data.plan, data.result);
      await client.invalidateQueries({ queryKey: ['staffing-budgets', companyId] });
      load.mutate(data.id); toast(t('common.saved'));
    } });
  const busy = calculate.isPending || save.isPending || load.isPending || loadRevision.isPending || refreshing;
  const readOnly = !!revision;
  const change = (update: (previous: Draft) => Draft) => {
    setDraft((previous) => previous ? update(previous) : null); setResult(null); calculate.reset(); save.reset();
  };
  const editLine = (id: string, patch: Partial<Draft['lines'][number]>) => change((previous) => ({ ...previous,
    lines: previous.lines.map((line) => line.positionId === id ? { ...line, ...patch } : line) }));
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await context.refetch();
      if (!fresh.data || fresh.error) throw fresh.error ?? new Error(t('common.loading'));
      const data = fresh.data;
      change((previous) => ({ ...previous, lines: data.positions.map((position) => previous.lines.find((line) => line.positionId === position.id)
        ?? { ...staffingDefaults(position.id, previous.year, data.company.fiscalYearStart), included: true }) }));
      setMetadata(Object.fromEntries(data.positions.map((position) => [position.id, position])));
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setRefreshing(false); }
  };
  const newPlan = () => {
    if (!context.data) return;
    setScenario(null); setRevision(''); setDraft(draftOf(newStaffingPlan(context.data))); setResult(null);
    setMetadata(Object.fromEntries(context.data.positions.map((position) => [position.id, position])));
    calculate.reset(); save.reset();
  };
  const money = (value: string) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: result?.currency ?? context.data?.company.currency ?? 'EUR' }).format(Number(value));
  const monthLabel = (month: string) => new Intl.DateTimeFormat(i18n.language, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const exportCsv = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([staffingBudgetCsv(result)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `staffing-budget-${result.year}${scenario ? `-v${revision || scenario.version}` : ''}.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  if (!canRead) return <p role="alert">{t('staffing.noAccess')}</p>;
  if (context.error) return <p role="alert" className="text-destructive">{context.error.message}</p>;
  if (!context.data || !draft) return <Skeleton className="h-72" />;
  const visible = draft.lines.filter((line) => metadata[line.positionId]?.status === 'OPEN' ? draft.includeOpen : draft.includeBudgeted);
  const canSave = hasPermission(me, scenario ? 'finance.budgets.update' : 'finance.budgets.create');
  const valid = !!draft.title.trim() && (draft.includeOpen || draft.includeBudgeted);
  const maxCost = Math.max(1, ...(result?.months.flatMap((month) => [Number(month.budget), Number(month.forecast)]) ?? []));
  return <>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label={t('staffing.savedPlans')} className="min-w-60 flex-1"><SelectInput value={scenario?.id ?? ''} disabled={busy}
        onChange={(event) => event.target.value ? load.mutate(event.target.value) : newPlan()}>
        <option value="">{t('staffing.newPlan')}</option>{saved.data?.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.year} · v{item.version}</option>)}
      </SelectInput></Field>
      <Button variant="secondary" disabled={busy} onClick={newPlan}>{t('staffing.newPlan')}</Button>
      {scenario && <Field label={t('staffing.revision')}><SelectInput value={revision} disabled={busy}
        onChange={(event) => event.target.value ? loadRevision.mutate(event.target.value) : load.mutate(scenario.id)}>
        <option value="">{t('staffing.currentRevision', { version: scenario.version })}</option>
        {scenario.revisions?.map((item) => <option key={item.version} value={item.version}>v{item.version} · {item.note ?? item.createdBy.firstName}</option>)}
      </SelectInput></Field>}
    </div>
    {saved.error && <p role="alert" className="mb-3 text-destructive">{saved.error.message}</p>}
    {readOnly && <p className="mb-3 text-sm text-muted-foreground">{t('staffing.historical')}</p>}
    {(load.isPending || loadRevision.isPending) ? <Skeleton className="h-72" /> : <>
    <fieldset disabled={busy || readOnly} className="mb-5 space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('staffing.planTitle')} required><TextInput value={draft.title} maxLength={120} onChange={(event) => change((previous) => ({ ...previous, title: event.target.value }))} /></Field>
        <Field label={t('staffing.year')}><TextInput type="number" min={2000} max={2100} value={draft.year} onChange={(event) => {
          const year = Number(event.target.value); const difference = year - draft.year;
          change((previous) => ({ ...previous, year, lines: previous.lines.map((line) => ({ ...line,
            plannedStart: shiftStaffingDate(line.plannedStart, difference) ?? '', forecastStart: shiftStaffingDate(line.forecastStart, difference) ?? '', endDate: shiftStaffingDate(line.endDate, difference) })) }));
        }} /></Field>
        <div className="self-end text-sm text-muted-foreground">{context.data.company.name} · {result?.currency ?? context.data.company.currency}<div className="text-xs">{t('staffing.fiscalStart', { month: result?.fiscalYearStart ?? context.data.company.fiscalYearStart })}</div></div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.includeOpen} onChange={(event) => change((previous) => ({ ...previous, includeOpen: event.target.checked }))} />{t('staffing.includeOpen')}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.includeBudgeted} onChange={(event) => change((previous) => ({ ...previous, includeBudgeted: event.target.checked }))} />{t('staffing.includeBudgeted')}</label>
        <Button size="sm" variant="secondary" onClick={() => void refresh()}><RefreshCw size={12} />{t('staffing.refreshPositions')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('staffing.assumptionsHint')}</p>
    </fieldset>
    <div className="mb-5 grid gap-4 xl:grid-cols-2">
      {!visible.length && <p className="text-sm text-muted-foreground">{t('staffing.noPositions')}</p>}
      {visible.map((line) => {
        const position = metadata[line.positionId];
        const amount = (key: 'annualSalary' | 'forecastAnnualSalary' | 'annualBonus' | 'monthlyBenefits' | 'recruitingCost', label: string, optional = false) => <Field label={t(`staffing.${label}`)}>
          <TextInput type="number" min={0} max={99999999} step="0.01" value={line[key] ?? ''} placeholder={optional ? line.annualSalary : undefined}
            onChange={(event) => editLine(line.positionId, { [key]: optional && !event.target.value ? null : event.target.value })} />
        </Field>;
        return <fieldset key={line.positionId} aria-label={position?.name ?? line.positionId} disabled={busy || readOnly} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold">{position?.name ?? line.positionId}</legend>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" aria-label={t('staffing.includePosition', { name: position?.name })} checked={line.included} onChange={(event) => editLine(line.positionId, { included: event.target.checked })} />
            {position?.code} · {position?.department?.name ?? t('hr.noDepartment')} · {t(`hr.positionStatus.${position?.status}`)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('staffing.headcount')}><TextInput type="number" min={1} max={100} step={1} value={line.headcount} onChange={(event) => editLine(line.positionId, { headcount: Number(event.target.value) })} /></Field>
            <Field label={t('staffing.fte')}><TextInput type="number" min={0.0001} max={1} step={0.01} value={line.fte} onChange={(event) => editLine(line.positionId, { fte: Number(event.target.value) })} /></Field>
            {amount('annualSalary', 'annualSalary')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('staffing.plannedStart')}><TextInput type="date" value={line.plannedStart} onChange={(event) => editLine(line.positionId, { plannedStart: event.target.value })} /></Field>
            <Field label={t('staffing.forecastStart')}><TextInput type="date" value={line.forecastStart} onChange={(event) => editLine(line.positionId, { forecastStart: event.target.value })} /></Field>
          </div>
          <details><summary className="cursor-pointer text-xs font-medium">{t('staffing.costAssumptions')}</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {amount('annualBonus', 'annualBonus')}{amount('monthlyBenefits', 'monthlyBenefits')}
              <Field label={t('staffing.employerCostPct')}><TextInput type="number" min={0} max={100} step="0.01" value={line.employerCostPct} onChange={(event) => editLine(line.positionId, { employerCostPct: Number(event.target.value) })} /></Field>
              {amount('recruitingCost', 'recruitingCost')}
              <Field label={t('staffing.hiringProbability')}><TextInput type="number" min={0} max={100} step="0.01" value={line.hiringProbability} onChange={(event) => editLine(line.positionId, { hiringProbability: Number(event.target.value) })} /></Field>
              {amount('forecastAnnualSalary', 'forecastAnnualSalary', true)}
              <Field label={t('staffing.endDate')}><TextInput type="date" value={line.endDate ?? ''} onChange={(event) => editLine(line.positionId, { endDate: event.target.value || null })} /></Field>
              <Field label={t('hr.office')}>{readOnly ? <TextInput readOnly value={result?.rows.find((row) => row.positionId === line.positionId)?.office?.name ?? '—'} /> : <SelectInput value={line.officeId ?? ''} onChange={(event) => editLine(line.positionId, { officeId: event.target.value || null })}>
                <option value="">—</option>{context.data!.offices.map((office) => <option key={office.id} value={office.id}>{office.code} · {office.name}</option>)}
              </SelectInput>}</Field>
            </div>
          </details>
        </fieldset>;
      })}
    </div>
    {!readOnly && <Field label={t('staffing.changeNote')}><TextArea maxLength={2000} value={draft.note ?? ''} onChange={(event) => setDraft((previous) => previous ? { ...previous, note: event.target.value } : null)} /></Field>}
    <div className="my-4 flex flex-wrap gap-2">
      {!readOnly && <Button disabled={busy || !valid} onClick={() => calculate.mutate()}>{t('staffing.calculate')}</Button>}
      {!readOnly && canSave && <Button variant="secondary" disabled={busy || !valid} onClick={() => save.mutate(false)}>{t('staffing.savePlan')}</Button>}
      {!readOnly && scenario && hasPermission(me, 'finance.budgets.create') && <Button variant="secondary" disabled={busy || !valid} onClick={() => save.mutate(true)}>{t('staffing.saveAsNew')}</Button>}
      <Button variant="secondary" disabled={!result || busy} onClick={exportCsv}><Download size={13} />{t('staffing.export')}</Button>
    </div>
    {(calculate.error || save.error) && <p role="alert" className="mb-4 text-sm text-destructive">{calculate.error?.message ?? save.error?.message}</p>}
    {result && <section aria-label={t('staffing.results')} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">{(['budget', 'forecast', 'variance'] as const).map((key) => <div key={key} className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">{t(`staffing.${key}`)}</div><div data-staffing-total={key} className="mt-1 text-xl font-semibold">{money(result.totals[key])}</div>
      </div>)}</div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs text-muted-foreground">{t('staffing.chartLegend')}</p>
        <div role="img" aria-label={t('staffing.monthlyChart')} className="grid h-44 grid-cols-12 gap-2">
          {result.months.map((month) => <div key={month.month} className="flex min-w-0 flex-col justify-end">
            <div className="flex h-36 items-end justify-center gap-1">
              <div title={`${t('staffing.budget')}: ${money(month.budget)}`} className="w-3 rounded-t bg-primary" style={{ height: `${Number(month.budget) / maxCost * 100}%` }} />
              <div title={`${t('staffing.forecast')}: ${money(month.forecast)}`} className="w-3 rounded-t bg-amber-500" style={{ height: `${Number(month.forecast) / maxCost * 100}%` }} />
            </div><span className="mt-2 truncate text-center text-[10px] text-muted-foreground">{monthLabel(month.month)}</span>
          </div>)}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-right text-sm">
        <caption className="p-3 text-left text-sm font-semibold">{t('staffing.monthlyTotals')}</caption>
        <thead><tr className="border-b border-border"><th className="p-3 text-left">{t('staffing.month')}</th>{['budget', 'forecast', 'variance', 'budgetFte', 'forecastFte'].map((key) => <th key={key} className="p-3">{t(`staffing.${key}`)}</th>)}</tr></thead>
        <tbody>{result.months.map((month) => <tr key={month.month} className="border-b border-border"><td className="p-3 text-left">{monthLabel(month.month)}</td><td className="p-3">{money(month.budget)}</td><td className="p-3">{money(month.forecast)}</td><td className="p-3">{money(month.variance)}</td><td className="p-3">{Number(month.budgetFte).toFixed(2)}</td><td className="p-3">{Number(month.forecastFte).toFixed(2)}</td></tr>)}</tbody>
      </table></div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-right text-sm">
        <caption className="p-3 text-left text-sm font-semibold">{t('staffing.positionTotals')}</caption>
        <thead><tr className="border-b border-border"><th className="p-3 text-left">{t('hr.position')}</th>{['budget', 'forecast', 'variance'].map((key) => <th key={key} className="p-3">{t(`staffing.${key}`)}</th>)}</tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.positionId} className="border-b border-border"><td className="p-3 text-left">{row.name} · {row.headcount} × {row.fte} FTE</td><td className="p-3">{money(row.totals.budget)}</td><td className="p-3">{money(row.totals.forecast)}</td><td className="p-3">{money(row.totals.variance)}</td></tr>)}</tbody>
      </table></div>
      <div className="grid gap-4 lg:grid-cols-2">{(['departments', 'offices'] as const).map((group) => <div key={group} className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-right text-sm">
        <caption className="p-3 text-left font-semibold">{t(`staffing.${group}`)}</caption>
        <thead><tr className="border-b border-border"><th className="p-3 text-left">{t('common.name')}</th><th className="p-3">{t('staffing.budget')}</th><th className="p-3">{t('staffing.forecast')}</th></tr></thead>
        <tbody>{result[group].map((row) => <tr key={row.id ?? 'unassigned'} className="border-b border-border"><td className="p-3 text-left">{row.name ?? t('staffing.unassigned')}</td><td className="p-3">{money(row.budget)}</td><td className="p-3">{money(row.forecast)}</td></tr>)}</tbody>
      </table></div>)}</div>
    </section>}
    </>}
  </>;
}

export function StaffingBudgetPage() {
  const { t } = useTranslation();
  const companyId = useAuthStore((state) => state.companyId);
  return <><HrNav /><h1 className="mb-4 text-lg font-bold">{t('staffing.title')}</h1><StaffingBudgetWorkspace key={companyId ?? 'none'} companyId={companyId} /></>;
}
