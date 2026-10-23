import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { PortfolioResult, SourcingOptionInput, SourcingResult } from '../../../../../packages/shared/src/business-engine';
import { HBarList } from '../../components/charts';
import { Button, Field, SelectInput, Tabs, TextInput, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { BasisBadge, EngineNav, FilterBar, IllustrativeBanner, NoAccess, PageHeader, QueryState, Section, Table, WarningsList, td, tdNum, useCan } from './components';
import { LineChart, SERIES, StackedColumns } from './charts';
import { enginePost, filterQuery, useEngineFilters, useEngineQuery } from './queries';
import { useFormat } from './format';

const REPORTS = ['service-profitability', 'project-profitability', 'financial-forecast', 'cash-flow', 'resource-utilization', 'capacity-gaps'];

export function EngineFinancialsPage() {
  const { t } = useTranslation();
  const can = useCan(); const f = useEngineFilters(); const toast = useToast();
  const [tab, setTab] = useState('pnl'); const [grain, setGrain] = useState<'months' | 'weeks'>('months');
  const params = filterQuery({ mode: f.mode, clientId: f.clientId, serviceId: f.serviceId, scenarioId: f.scenarioId, departmentId: f.departmentId });
  const q = useEngineQuery<{ result: PortfolioResult }>(['portfolio', f.mode, f.clientId, f.serviceId, f.scenarioId, f.departmentId], can('engine.economics.read') ? `/analytics/portfolio?${params}` : null);
  const r = q.data?.result; const fmt = useFormat(r?.currency);
  if (!can('engine.economics.read')) return <><EngineNav /><NoAccess permission="engine.economics.read" /></>;
  const basis = f.scenarioId ? 'SIMULATED' : f.mode === 'EXPECTED' ? 'WEIGHTED' : f.mode === 'ALL_WIN' ? 'SIMULATED' : 'CONTRACTED';
  const download = (code: string) => api.download(`/engine/analytics/reports/${code}?${params}`, `${code}.csv`).catch((e: Error) => toast(e.message, 'error'));
  const totalClient = r ? r.byClient.reduce((s, c) => s + Number(c.revenue), 0) : 0;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.financials.title')} subtitle={t('engine.financials.subtitle')} actions={can('engine.economics.export') && (
        <SelectInput className="h-8 w-56 text-xs" value="" onChange={(e) => e.target.value && download(e.target.value)}>
          <option value="">{t('engine.financials.export')}</option>{REPORTS.map((c) => <option key={c} value={c}>{t(`engine.report.${c}`)}</option>)}
        </SelectInput>)} />
      <FilterBar />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'pnl', label: t('engine.financials.pnl') }, { key: 'cash', label: t('engine.financials.cash') },
        { key: 'profitability', label: t('engine.financials.profitability') }, { key: 'sourcing', label: t('engine.financials.sourcing') }]} />
      <div className="mt-3">
        {tab === 'sourcing' ? <SourcingCalculator /> : (
          <QueryState query={q}>
            {r && <>
              <IllustrativeBanner show={r.illustrativeConfig} />
              <WarningsList warnings={r.warnings} />
              {tab === 'pnl' && <div className="space-y-3">
                <Section title={<span className="flex items-center gap-2">{t('engine.financials.pnlChart')} <BasisBadge basis={basis} /></span>}>
                  <StackedColumns labels={r.pnl.map((p) => fmt.month(p.key))} format={(v) => fmt.compact(v)}
                    series={[{ label: t('engine.series.contribution'), color: SERIES[0], values: r.pnl.map((p) => Number(p.contribution)) }]}
                    line={{ label: t('engine.series.operatingResult'), color: SERIES[1], values: r.pnl.map((p) => Number(p.operatingResult)) }} />
                </Section>
                <Section title={t('engine.financials.pnlTable')}>
                  <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.financials.pnlHint')}</p>
                  <Table head={[t('engine.col.month'), t('engine.financials.revContracted'), t('engine.financials.revPipeline'), t('engine.financials.externalCost'), t('engine.financials.internalApplied'),
                    t('engine.col.contribution'), t('engine.financials.capacityCost'), t('engine.financials.unabsorbed'), t('engine.financials.overhead'), t('engine.col.operatingResult'), t('engine.financials.actualInvoiced')]}>
                    {r.pnl.map((p) => <tr key={p.key}><td className={td}>{fmt.month(p.key)}</td><td className={tdNum}>{fmt.moneyShort(p.revenueContracted)}</td><td className={tdNum}>{fmt.moneyShort(p.revenuePipeline)}</td>
                      <td className={tdNum}>{fmt.moneyShort(p.externalCost)}</td><td className={tdNum}>{fmt.moneyShort(p.internalApplied)}</td><td className={tdNum}>{fmt.moneyShort(p.contribution)}</td>
                      <td className={tdNum}>{fmt.moneyShort(p.capacityCost)}</td><td className={tdNum}>{fmt.moneyShort(p.unabsorbedCapacity)}</td><td className={tdNum}>{fmt.moneyShort(p.overhead)}</td>
                      <td className={`${tdNum} font-medium ${Number(p.operatingResult) < 0 ? 'text-destructive' : ''}`}>{fmt.moneyShort(p.operatingResult)}</td><td className={tdNum}>{p.actualInvoiced ? fmt.moneyShort(p.actualInvoiced) : '—'}</td></tr>)}
                    <tr className="font-semibold"><td className={td}>Σ</td><td className={tdNum} colSpan={4} /><td className={tdNum}>{fmt.moneyShort(r.totals.contribution)}</td><td className={tdNum}>{fmt.moneyShort(r.totals.capacityCost)}</td>
                      <td className={tdNum}>{fmt.moneyShort(r.totals.unabsorbedCapacity)}</td><td className={tdNum}>{fmt.moneyShort(r.totals.overhead)}</td><td className={tdNum}>{fmt.moneyShort(r.totals.operatingResult)}</td><td /></tr>
                  </Table>
                </Section>
                {r.history.length > 0 && <Section title={<span className="flex items-center gap-2">{t('engine.financials.history')} <BasisBadge basis="ACTUAL" /></span>}>
                  <StackedColumns labels={r.history.map((h) => fmt.month(h.month))} format={(v) => fmt.compact(v)} series={[{ label: t('engine.financials.actualInvoiced'), color: SERIES[0], values: r.history.map((h) => Number(h.invoicedNet)) }]} />
                </Section>}
              </div>}
              {tab === 'cash' && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {[[t('engine.financials.opening'), fmt.moneyShort(r.cash.opening), r.cash.openingSource === 'BANK' ? 'ACTUAL' : 'MISSING'], [t('engine.kpi.minCash'), fmt.moneyShort(r.cash.minBalance), basis],
                    [t('engine.financials.peakDeficit'), fmt.moneyShort(r.cash.peakDeficit), basis], [t('engine.financials.financingNeed'), fmt.moneyShort(r.cash.financingRequirement), basis],
                    [t('engine.financials.endBalance'), fmt.moneyShort(r.cash.endBalance), basis]].map(([k, v, b]) => (
                    <div key={k} className="rounded-lg border border-border bg-card p-2.5"><div className="flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">{k}<BasisBadge basis={b as never} /></div><div className="text-lg font-semibold">{v}</div></div>))}
                </div>
                <Section title={t('engine.financials.cashChart')} actions={<SelectInput className="h-7 w-32 py-0 text-xs" value={grain} onChange={(e) => setGrain(e.target.value as 'months' | 'weeks')}><option value="months">{t('engine.financials.monthly')}</option><option value="weeks">{t('engine.financials.weekly')}</option></SelectInput>}>
                  <LineChart labels={r.cash[grain].map((p) => (grain === 'months' ? fmt.month(p.key) : p.key.slice(5)))} format={(v) => fmt.compact(v)}
                    series={[{ label: t('engine.series.closingCash', { mode: t(`engine.mode.${r.mode}`) }), color: SERIES[0], values: r.cash[grain].map((p) => Number(p.closing)) }]} reference={{ value: 0, label: '0' }} />
                </Section>
                <Section title={t('engine.financials.cashTable')}>
                  <Table head={[t('engine.col.period'), t('engine.financials.receipts'), t('engine.financials.payments'), t('engine.financials.vat'), t('engine.financials.net'), t('engine.financials.closing'), t('engine.col.basis')]}>
                    {r.cash[grain].map((p) => <tr key={p.key}><td className={td}>{grain === 'months' ? fmt.month(p.key) : p.key}</td><td className={tdNum}>{fmt.moneyShort(p.receipts)}</td><td className={tdNum}>{fmt.moneyShort(p.payments)}</td>
                      <td className={tdNum}>{fmt.moneyShort(p.vat)}</td><td className={tdNum}>{fmt.moneyShort(p.net)}</td><td className={`${tdNum} ${Number(p.closing) < 0 ? 'text-destructive' : ''}`}>{fmt.moneyShort(p.closing)}</td><td className={td}><BasisBadge basis={p.basis} /></td></tr>)}
                  </Table>
                  <p className="mt-2 text-[11px] text-muted-foreground">{t('engine.financials.cashHint')} {r.cash.byCategory.map((c) => `${t(`engine.cashCategory.${c.category}`)}: ${fmt.moneyShort(c.amount)}`).join(' · ')}</p>
                </Section>
              </div>}
              {tab === 'profitability' && <div className="grid gap-3 xl:grid-cols-2">
                <Section title={t('engine.financials.byService')}>
                  <Table head={[t('engine.col.service'), t('engine.col.revenue'), t('engine.col.directCost'), t('engine.col.contribution'), t('engine.col.margin'), t('engine.col.hours')]}>
                    {r.byService.map((s) => <tr key={s.key}><td className={td}>{s.name}</td><td className={tdNum}>{fmt.moneyShort(s.revenue)}</td><td className={tdNum}>{fmt.moneyShort(s.directCost)}</td>
                      <td className={`${tdNum} ${Number(s.contribution) < 0 ? 'text-destructive' : ''}`}>{fmt.moneyShort(s.contribution)}</td><td className={tdNum}>{fmt.pct(s.marginPct)}</td><td className={tdNum}>{fmt.hours(s.hours)}</td></tr>)}
                  </Table>
                </Section>
                <Section title={t('engine.financials.byClient')}>
                  <HBarList data={r.byClient.map((c) => ({ label: c.name, value: Number(c.revenue), detail: `${fmt.compact(c.revenue)} · ${totalClient > 0 ? fmt.pct((Number(c.revenue) / totalClient) * 100) : '—'} · ${t('engine.col.margin')} ${fmt.pct(c.marginPct)}` }))} />
                  {r.totals.topClientSharePct !== null && <p className="mt-2 text-[11px] text-muted-foreground">{t('engine.financials.concentration', { pct: r.totals.topClientSharePct })}</p>}
                </Section>
                <Section title={t('engine.financials.byAssignment')} className="xl:col-span-2">
                  <Table head={[t('engine.col.assignment'), t('engine.col.client'), t('engine.col.commitment'), t('engine.col.revenue'), t('engine.col.costAtCompletion'), t('engine.col.contribution'), t('engine.col.margin'), t('engine.col.baselineVar'), t('engine.col.allocatedOverhead'), t('engine.col.operatingResult')]}>
                    {r.assignments.map((a) => <tr key={a.id}><td className={td}>{a.title}</td><td className={td}>{a.clientName}</td><td className={td}><BasisBadge basis={a.commitment === 'PIPELINE' ? 'WEIGHTED' : a.commitment === 'COMPLETED' ? 'ACTUAL' : 'CONTRACTED'} /></td>
                      <td className={tdNum}>{fmt.moneyShort(a.revenue)}</td><td className={tdNum}>{fmt.moneyShort(a.costAtCompletion)}</td><td className={`${tdNum} ${Number(a.contribution) < 0 ? 'text-destructive' : ''}`}>{fmt.moneyShort(a.contribution)}</td>
                      <td className={tdNum}>{fmt.pct(a.marginPct)}</td><td className={`${tdNum} ${(a.marginVariancePts ?? 0) < 0 ? 'text-destructive' : ''}`}>{a.marginVariancePts === null ? '—' : `${a.marginVariancePts} pts`}</td>
                      <td className={tdNum}>{fmt.moneyShort(a.allocatedOverhead)}</td><td className={tdNum}>{fmt.moneyShort(a.operatingResult)}</td></tr>)}
                  </Table>
                </Section>
              </div>}
            </>}
          </QueryState>
        )}
      </div>
    </>
  );
}

const defaultOptions: SourcingOptionInput[] = [
  { kind: 'INTERNAL', label: 'Internal team', hourlyCost: '', capacityHours: null },
  { kind: 'HIRE', label: 'New hire', annualSalary: '', weeklyHours: 40 },
  { kind: 'FREELANCE', label: 'Freelancer', hourlyCost: '', leadTimeWeeks: 2 },
  { kind: 'SUBCONTRACT', label: 'Engineering partner', hourlyCost: '', coordinationOverheadPct: 10, qualityControlPct: 5 },
];
function SourcingCalculator() {
  const { t } = useTranslation(); const fmt = useFormat(); const toast = useToast();
  const [demand, setDemand] = useState('1000'); const [billRate, setBillRate] = useState(''); const [within, setWithin] = useState('');
  const [options, setOptions] = useState<SourcingOptionInput[]>(defaultOptions);
  const [result, setResult] = useState<SourcingResult | null>(null); const [busy, setBusy] = useState(false);
  const upd = (i: number, p: Partial<SourcingOptionInput>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const clean = (o: SourcingOptionInput) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)) as SourcingOptionInput;
  const run = async () => {
    setBusy(true);
    try { setResult(await enginePost<SourcingResult>('/analytics/sourcing', { demandHours: Number(demand), billRate, requiredWithinWeeks: within === '' ? null : Number(within), options: options.map(clean) })); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const num = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return (
    <div className="space-y-3">
      <Section title={t('engine.sourcing.title')}>
        <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.sourcing.hint')}</p>
        <div className="mb-3 grid grid-cols-3 gap-2 md:w-2/3">
          <Field label={t('engine.sourcing.demandHours')} required><TextInput type="number" min={1} value={demand} onChange={(e) => setDemand(e.target.value)} /></Field>
          <Field label={t('engine.sourcing.billRate')} required><TextInput inputMode="decimal" value={billRate} onChange={(e) => setBillRate(e.target.value)} /></Field>
          <Field label={t('engine.sourcing.within')}><TextInput type="number" min={0} value={within} onChange={(e) => setWithin(e.target.value)} /></Field>
        </div>
        <Table head={[t('engine.sourcing.kind'), t('engine.col.name'), t('engine.sourcing.hourlyCost'), t('engine.sourcing.salary'), t('engine.col.weeklyHours'), t('engine.sourcing.capacity'), t('engine.sourcing.lead'), t('engine.sourcing.coordination'), t('engine.sourcing.qc'), t('engine.sourcing.minCommitment'), t('engine.sourcing.risk'), '']}>
          {options.map((o, i) => (
            <tr key={i}>
              <td className="p-1"><SelectInput className="h-7 w-28 py-0 text-xs" value={o.kind} onChange={(e) => upd(i, { kind: e.target.value as SourcingOptionInput['kind'] })}>{['INTERNAL', 'HIRE', 'FREELANCE', 'SUBCONTRACT', 'PARTNER', 'HYBRID'].map((k) => <option key={k} value={k}>{t(`engine.sourcingKind.${k}`)}</option>)}</SelectInput></td>
              <td className="p-1"><TextInput className="h-7 w-32 py-0 text-xs" value={o.label} onChange={(e) => upd(i, { label: e.target.value })} /></td>
              <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" disabled={o.kind === 'HIRE'} value={num(o.hourlyCost)} onChange={(e) => upd(i, { hourlyCost: e.target.value })} /></td>
              <td className="p-1"><TextInput className="h-7 w-24 py-0 text-xs" disabled={o.kind !== 'HIRE'} value={num(o.annualSalary)} onChange={(e) => upd(i, { annualSalary: e.target.value })} /></td>
              <td className="p-1"><TextInput className="h-7 w-14 py-0 text-xs" disabled={o.kind !== 'HIRE'} value={num(o.weeklyHours)} onChange={(e) => upd(i, { weeklyHours: e.target.value ? Number(e.target.value) : undefined })} /></td>
              <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={num(o.capacityHours)} onChange={(e) => upd(i, { capacityHours: e.target.value ? Number(e.target.value) : null })} /></td>
              <td className="p-1"><TextInput className="h-7 w-14 py-0 text-xs" value={num(o.leadTimeWeeks)} onChange={(e) => upd(i, { leadTimeWeeks: e.target.value ? Number(e.target.value) : undefined })} /></td>
              <td className="p-1"><TextInput className="h-7 w-14 py-0 text-xs" value={num(o.coordinationOverheadPct)} onChange={(e) => upd(i, { coordinationOverheadPct: e.target.value ? Number(e.target.value) : undefined })} /></td>
              <td className="p-1"><TextInput className="h-7 w-14 py-0 text-xs" value={num(o.qualityControlPct)} onChange={(e) => upd(i, { qualityControlPct: e.target.value ? Number(e.target.value) : undefined })} /></td>
              <td className="p-1"><TextInput className="h-7 w-16 py-0 text-xs" value={num(o.minimumCommitmentHours)} onChange={(e) => upd(i, { minimumCommitmentHours: e.target.value ? Number(e.target.value) : undefined })} /></td>
              <td className="p-1"><SelectInput className="h-7 w-14 py-0 text-xs" value={num(o.riskScore)} onChange={(e) => upd(i, { riskScore: e.target.value ? Number(e.target.value) : undefined })}><option value="">—</option>{[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}</SelectInput></td>
              <td className="p-1"><button aria-label={t('engine.common.remove')} onClick={() => setOptions(options.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
            </tr>))}
        </Table>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setOptions([...options, { kind: 'PARTNER', label: '', hourlyCost: '' }])}><Plus size={12} />{t('engine.common.add')}</Button>
          <Button size="sm" disabled={busy || !billRate || !demand} onClick={() => void run()}>{t('engine.sourcing.compare')}</Button></div>
      </Section>
      {result && <Section title={t('engine.sourcing.result')}>
        <Table head={[t('engine.col.name'), t('engine.sourcing.feasible'), t('engine.sourcing.effectiveRate'), t('engine.sourcing.totalCost'), t('engine.col.contribution'), t('engine.col.margin'), t('engine.sourcing.fixedExposure'), t('engine.sourcing.lead'), t('engine.sourcing.breakEven'), t('engine.col.note')]}>
          {result.options.map((o) => <tr key={o.label} className={o.label === result.recommendation.label ? 'bg-accent/50' : ''}>
            <td className={td}>{o.label}{o.label === result.recommendation.label && ' ★'}</td><td className={td}>{o.feasible ? '✓' : <span className="text-destructive">{o.infeasibleReasons.join('; ')}</span>}</td>
            <td className={tdNum}>{fmt.money(o.effectiveHourlyCost)}</td><td className={tdNum}>{fmt.moneyShort(o.totalCost)}</td><td className={`${tdNum} ${Number(o.contribution) < 0 ? 'text-destructive' : ''}`}>{fmt.moneyShort(o.contribution)}</td>
            <td className={tdNum}>{fmt.pct(o.marginPct)}</td><td className={tdNum}>{fmt.moneyShort(o.fixedCostExposure)}</td><td className={tdNum}>{o.leadTimeWeeks}</td>
            <td className={tdNum}>{o.hiring ? `${fmt.pct(o.hiring.breakEvenUtilizationPct)}${o.hiring.breakEvenHoursVsFreelance ? ` · ${fmt.hours(o.hiring.breakEvenHoursVsFreelance)}` : ''}` : '—'}</td>
            <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{o.notes.join(' · ')}</td></tr>)}
        </Table>
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
          <div><b>{t('engine.sourcing.recommendation')}:</b> {result.recommendation.label ?? '—'}<ul className="list-disc pl-4 text-muted-foreground">{result.recommendation.basis.map((b) => <li key={b}>{b}</li>)}</ul></div>
          <div><b>{t('engine.sourcing.assumptionsRisks')}:</b><ul className="list-disc pl-4 text-muted-foreground">{[...result.recommendation.assumptions, ...result.recommendation.risks].map((b) => <li key={b}>{b}</li>)}</ul>
            {result.recommendation.alternatives.length > 0 && <p className="mt-1 text-muted-foreground">{t('engine.sourcing.alternatives')}: {result.recommendation.alternatives.join('; ')}</p>}</div>
        </div>
      </Section>}
    </div>
  );
}
