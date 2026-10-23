import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Square, Trash2 } from 'lucide-react';
import type { OptimizationResult } from '../../../../../packages/shared/src/business-engine';
import { Button, Field, SelectInput, TextInput } from '../../components/ui';
import { BasisBadge, EngineNav, NoAccess, PageHeader, QueryState, Section, Table, td, tdNum, useCan } from './components';
import { enginePost, pollWhileRunning, useEngineMutation, useEngineQuery } from './queries';
import { today, useFormat } from './format';

const OBJECTIVES = ['CONTRIBUTION', 'OPERATING_PROFIT', 'CASH', 'PEAK_WORKING_CAPITAL', 'RISK_ADJUSTED_VALUE', 'STRATEGIC'];
interface RunRow { id: string; name: string | null; status: string; objectiveValue: string | null; gapPct: string | null; runtimeMs: number | null; createdAt: string; error: string | null }
interface RunDetail extends RunRow { running: boolean; result: OptimizationResult | null; configuration: Record<string, unknown> }
interface Hire { name: string; skillIds: string[]; weeklyHours: number; start: string; monthlyFixedCost: string; costRate: string; rampUpWeeks: number }

const STATUS_TONE: Record<string, string> = { OPTIMAL: 'text-success', FEASIBLE: 'text-warning', INFEASIBLE: 'text-destructive', TIMED_OUT: 'text-destructive', FAILED: 'text-destructive', CANCELLED: 'text-muted-foreground', RUNNING: 'text-muted-foreground' };

export function EngineOptimizationPage() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const runs = useEngineQuery<RunRow[]>(['optimizations'], can('engine.optimization.read') ? '/optimizations' : null);
  const refs = useEngineQuery<{ opportunities: { id: string; opportunityNumber: string; title: string }[] }>(['references'], can('engine.portfolio.read') ? '/assignments/references' : null);
  const skills = useEngineQuery<{ id: string; name: string }[]>(['skills'], '/skills');
  const [selected, setSelected] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({ CONTRIBUTION: 1 });
  const [cfg, setCfg] = useState({ name: '', timeLimitSeconds: 10, allowExternalSourcing: true, allowShifts: true, cashConstraint: true, basis: 'IF_WON' });
  const [hires, setHires] = useState<Hire[]>([]); const [mandatory, setMandatory] = useState<string[]>([]); const [excluded, setExcluded] = useState<string[]>([]);
  const detail = useEngineQuery<RunDetail>(['optimization', selected], selected && can('engine.economics.read') ? `/optimizations/${selected}` : null, { refetchInterval: pollWhileRunning });
  const start = useEngineMutation(() => enginePost<RunDetail>('/optimizations', { ...cfg, name: cfg.name || undefined, objectiveWeights: Object.fromEntries(Object.entries(weights).filter(([, v]) => v > 0)),
    hireOptions: hires.map((h) => ({ type: 'HIRE', ...h })), mandatoryOpportunityKeys: mandatory, excludedOpportunityKeys: excluded }), { onSuccess: (r) => setSelected(r.id) });
  const cancel = useEngineMutation(() => enginePost(`/optimizations/${selected}/cancel`));
  const decide = useEngineMutation(() => enginePost('/intelligence/decisions', { title: t('engine.optimization.decisionTitle', { name: detail.data?.name ?? fmt.dateTime(detail.data?.createdAt) }), optimizationRunId: selected }), { success: t('engine.optimization.decisionCreated') });
  if (!can('engine.optimization.read')) return <><EngineNav /><NoAccess permission="engine.optimization.read" /></>;
  const r = detail.data?.result;
  const oppLabel = (key: string) => { const o = refs.data?.opportunities.find((x) => x.id === key); return o ? `${o.opportunityNumber} · ${o.title}` : key; };
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.optimization.title')} subtitle={t('engine.optimization.subtitle')} />
      <div className="grid gap-3 xl:grid-cols-[380px_1fr]">
        <div className="space-y-3">
          {can('engine.optimization.create') && <Section title={t('engine.optimization.configure')}>
            <div className="space-y-2">
              <Field label={t('engine.col.name')}><TextInput value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
              <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('engine.optimization.objectives')}</div>
                {OBJECTIVES.map((o) => <label key={o} className="mb-1 flex items-center justify-between gap-2 text-xs">{t(`engine.objective.${o}`)}
                  <TextInput className="h-7 w-20 py-0 text-xs" type="number" min={0} value={weights[o] ?? 0} onChange={(e) => setWeights({ ...weights, [o]: Number(e.target.value) })} /></label>)}
                <p className="text-[11px] text-muted-foreground">{t('engine.optimization.weightsHint')}</p></div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('engine.optimization.timeLimit')}><TextInput type="number" min={1} max={120} value={cfg.timeLimitSeconds} onChange={(e) => setCfg({ ...cfg, timeLimitSeconds: Number(e.target.value) })} /></Field>
                <Field label={t('engine.optimization.basis')}><SelectInput value={cfg.basis} onChange={(e) => setCfg({ ...cfg, basis: e.target.value })}><option value="IF_WON">{t('engine.optimization.ifWon')}</option><option value="EXPECTED">{t('engine.optimization.expected')}</option></SelectInput></Field>
              </div>
              {(['allowExternalSourcing', 'allowShifts', 'cashConstraint'] as const).map((k) => <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.checked })} />{t(`engine.optimization.${k}`)}</label>)}
              <Field label={t('engine.optimization.mandatory')}><select multiple className="h-16 w-full rounded-md border border-border bg-background text-xs" value={mandatory} onChange={(e) => setMandatory([...e.target.selectedOptions].map((o) => o.value))}>
                {refs.data?.opportunities.map((o) => <option key={o.id} value={o.id}>{o.opportunityNumber} · {o.title}</option>)}</select></Field>
              <Field label={t('engine.optimization.excluded')}><select multiple className="h-16 w-full rounded-md border border-border bg-background text-xs" value={excluded} onChange={(e) => setExcluded([...e.target.selectedOptions].map((o) => o.value))}>
                {refs.data?.opportunities.map((o) => <option key={o.id} value={o.id}>{o.opportunityNumber} · {o.title}</option>)}</select></Field>
              <div><div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">{t('engine.optimization.hireOptions')}
                <Button size="sm" variant="ghost" onClick={() => setHires([...hires, { name: t('engine.optimization.newHire'), skillIds: [], weeklyHours: 40, start: today(), monthlyFixedCost: '', costRate: '', rampUpWeeks: 12 }])}><Plus size={12} /></Button></div>
                {hires.map((h, i) => { const u = (p: Partial<Hire>) => setHires(hires.map((x, j) => (j === i ? { ...x, ...p } : x))); return (
                  <div key={i} className="mb-2 grid grid-cols-2 gap-1 rounded-md border border-border p-1.5">
                    <TextInput className="h-7 py-0 text-xs" value={h.name} onChange={(e) => u({ name: e.target.value })} />
                    <TextInput className="h-7 py-0 text-xs" type="date" value={h.start} onChange={(e) => u({ start: e.target.value })} />
                    <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.resources.monthlyFixed')} value={h.monthlyFixedCost} onChange={(e) => u({ monthlyFixedCost: e.target.value })} />
                    <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.col.costRate')} value={h.costRate} onChange={(e) => u({ costRate: e.target.value })} />
                    <select multiple className="col-span-2 h-14 rounded-md border border-border bg-background text-xs" value={h.skillIds} onChange={(e) => u({ skillIds: [...e.target.selectedOptions].map((o) => o.value) })}>
                      {skills.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <button className="col-span-2 text-right text-xs text-muted-foreground" onClick={() => setHires(hires.filter((_, j) => j !== i))}><Trash2 size={12} className="inline" /> {t('engine.common.remove')}</button>
                  </div>); })}
              </div>
              <Button disabled={start.isPending || !Object.values(weights).some((v) => v > 0) || hires.some((h) => !h.monthlyFixedCost || !h.costRate)} onClick={() => start.mutate(undefined)}><Play size={13} />{t('engine.optimization.run')}</Button>
            </div>
          </Section>}
          <Section title={t('engine.optimization.history')}>
            <QueryState query={runs} empty={!runs.data?.length}>
              <ul className="space-y-1 text-xs">{runs.data?.map((x) => <li key={x.id}><button className={`w-full rounded px-2 py-1 text-left ${selected === x.id ? 'bg-accent' : 'hover:bg-muted'}`} onClick={() => setSelected(x.id)}>
                <span className={`font-medium ${STATUS_TONE[x.status]}`}>{t(`engine.solver.${x.status}`)}</span> · {x.name ?? fmt.dateTime(x.createdAt)}{x.runtimeMs !== null && ` · ${x.runtimeMs} ms`}</button></li>)}</ul>
            </QueryState>
          </Section>
        </div>
        <div className="space-y-3">
          {!selected && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('engine.optimization.pick')}</p>}
          {selected && <QueryState query={detail}>{detail.data && <>
            <Section title={<span className="flex items-center gap-2">{t('engine.optimization.result')} <BasisBadge basis="SIMULATED" /></span>} actions={<div className="flex gap-1">
              {detail.data.running && <Button size="sm" variant="secondary" onClick={() => cancel.mutate(undefined)}><Square size={11} />{t('engine.common.cancel')}</Button>}
              {r && ['OPTIMAL', 'FEASIBLE'].includes(r.status) && can('engine.intelligence.create') && <Button size="sm" variant="secondary" onClick={() => decide.mutate(undefined)}>{t('engine.optimization.toDecision')}</Button>}</div>}>
              <div className="mb-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
                <div><div className="text-muted-foreground">{t('engine.optimization.status')}</div><div className={`text-base font-semibold ${STATUS_TONE[detail.data.status]}`}>{t(`engine.solver.${detail.data.status}`)}</div><div className="text-[10px] text-muted-foreground">{r?.solverStatus}</div></div>
                <div><div className="text-muted-foreground">{t('engine.optimization.objective')}</div><div className="font-semibold">{r?.objectiveValue ?? '—'}</div></div>
                <div><div className="text-muted-foreground">{t('engine.optimization.bound')}</div><div className="font-semibold">{r?.bound ?? '—'}</div></div>
                <div><div className="text-muted-foreground">{t('engine.optimization.gap')}</div><div className="font-semibold">{r?.gapPct === null || r?.gapPct === undefined ? '—' : `${r.gapPct} %`}</div></div>
                <div><div className="text-muted-foreground">{t('engine.optimization.runtime')}</div><div className="font-semibold">{detail.data.runtimeMs ?? '…'} ms</div></div>
                <div><div className="text-muted-foreground">{t('engine.optimization.size')}</div><div className="font-semibold">{r ? `${r.variables} / ${r.constraints}` : '—'}</div></div>
              </div>
              {detail.data.error && <p className="text-xs text-destructive">{detail.data.error}</p>}
              {r && <>
                <div className="mb-2 grid gap-2 md:grid-cols-3">{Object.entries(r.objectives).map(([k, v]) => <div key={k} className="rounded-md border border-border p-2 text-xs"><div className="text-muted-foreground">{t(`engine.objective.${k}`)}</div><div className="font-semibold">{k === 'STRATEGIC' ? fmt.num(v) : fmt.moneyShort(v)}</div></div>)}</div>
                {r.diagnostics.length > 0 && <ul className="mb-2 list-disc pl-4 text-xs text-warning">{r.diagnostics.map((x) => <li key={x}>{x}</li>)}</ul>}
                <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">{t('engine.optimization.approximations')} · {r.solver}</summary><ul className="list-disc pl-4">{r.approximations.map((x) => <li key={x}>{x}</li>)}</ul></details>
              </>}
            </Section>
            {r && <>
              <Section title={t('engine.optimization.decisions')}>
                <Table head={[t('engine.col.decision'), t('engine.col.name'), t('engine.optimization.variant'), t('engine.col.revenue'), t('engine.col.contribution'), t('engine.optimization.coefficient'), t('engine.optimization.reducedCost')]}>
                  {r.candidates.map((c) => <Fragment key={c.key}>
                    <tr className={c.selected ? 'bg-accent/40' : ''}>
                      <td className={td}>{c.selected ? `✓ ${t('engine.optimization.selected')}` : t('engine.optimization.rejected')}{c.mandatory && ' *'}</td><td className={td}>{c.kind === 'HIRE' ? c.title : oppLabel(c.key) || c.title}</td>
                      <td className={td}>{c.variant ? t(`engine.variant.${c.variant.startsWith('SHIFT') ? 'SHIFT' : c.variant}`, { weeks: c.variant.replace(/\D/g, '') }) : '—'}</td>
                      <td className={tdNum}>{fmt.moneyShort(c.revenue)}</td><td className={tdNum}>{fmt.moneyShort(c.contribution)}</td><td className={tdNum}>{fmt.num(c.objectiveCoefficient)}</td>
                      <td className={tdNum}>{c.reducedCost === null ? '—' : fmt.num(c.reducedCost)}</td>
                    </tr>
                    <tr className={c.selected ? 'bg-accent/40' : ''}><td colSpan={7} className="px-2 pb-2 text-[11px] text-muted-foreground">{c.reasons.join(' ')}{c.alternatives.length > 1 && ` ${t('engine.optimization.why')}: ${c.alternatives.map((a) => `${t(`engine.variant.${a.variant.startsWith('SHIFT') ? 'SHIFT' : a.variant}`, { weeks: a.variant.replace(/\D/g, '') })} ${fmt.num(a.objectiveCoefficient)}`).join(' · ')}`}</td></tr>
                  </Fragment>)}
                </Table>
              </Section>
              <div className="grid gap-3 xl:grid-cols-2">
                <Section title={t('engine.optimization.binding')}>
                  <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.optimization.bindingHint')}</p>
                  <Table head={[t('engine.col.constraint'), t('engine.col.month'), t('engine.optimization.shadowPrice')]}>
                    {r.binding.map((b) => <tr key={b.name}><td className={td}>{b.label}</td><td className={td}>{b.periodKey ? fmt.month(b.periodKey) : '—'}</td><td className={tdNum}>{b.shadowPrice === null ? '—' : fmt.num(b.shadowPrice)}</td></tr>)}
                  </Table>
                  {!r.binding.length && <p className="text-xs text-muted-foreground">{t('engine.optimization.noBinding')}</p>}
                  {r.baselineCapacityOverloads.length > 0 && <><h3 className="mb-1 mt-3 text-xs font-semibold">{t('engine.optimization.baselineOverloads')}</h3>
                    <ul className="text-[11px] text-muted-foreground">{r.baselineCapacityOverloads.map((o, i) => <li key={i}>{o.label} · {fmt.month(o.periodKey)} · {fmt.hours(o.excessHours)}</li>)}</ul></>}
                </Section>
                <Section title={t('engine.optimization.verification')}>
                  <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.optimization.verificationHint')}</p>
                  {r.verification ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{(['revenue', 'contribution', 'operatingResult', 'minCash', 'peakDeficit', 'financingRequirement'] as const).map((k) => (
                    <div key={k} className="flex justify-between border-b border-border/50"><dt className="text-muted-foreground">{t(`engine.metric.${k}`)}</dt><dd>{fmt.moneyShort(r.verification?.[k])}</dd></div>))}
                    <div className="flex justify-between border-b border-border/50"><dt className="text-muted-foreground">{t('engine.metric.utilization')}</dt><dd>{fmt.pct(r.verification.utilization, true)}</dd></div>
                    <div className="flex justify-between border-b border-border/50"><dt className="text-muted-foreground">{t('engine.metric.shortageHours')}</dt><dd>{fmt.hours(r.verificationShortageHours)}</dd></div></dl>
                    : <p className="text-xs text-muted-foreground">—</p>}
                </Section>
              </div>
            </>}
          </>}</QueryState>}
        </div>
      </div>
    </>
  );
}
