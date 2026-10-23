import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Play, Plus, Square, Trash2 } from 'lucide-react';
import type { MonteCarloResult, ScenarioComparisonRow, ScenarioMetrics, SensitivityResult } from '../../../../../packages/shared/src/business-engine';
import { Button, Field, SelectInput, TextArea, TextInput } from '../../components/ui';
import { BasisBadge, EngineNav, NoAccess, PageHeader, QueryState, Section, Table, td, tdNum, useCan } from './components';
import { LineChart, SERIES } from './charts';
import { engineDelete, enginePost, enginePut, pollWhileRunning, useEngineMutation, useEngineQuery, type PortfolioMode } from './queries';
import { useFormat } from './format';

type Op = Record<string, unknown> & { type: string };
type FieldKind = 'assignments' | 'opportunity' | 'service' | 'client' | 'skills' | 'skill' | 'resource' | 'number' | 'money' | 'date' | 'text' | 'bool';
const OPS: Record<string, [string, FieldKind, boolean?][]> = {
  WIN: [['opportunityId', 'opportunity'], ['assignmentIds', 'assignments']], LOSE: [['opportunityId', 'opportunity'], ['assignmentIds', 'assignments']],
  SHIFT: [['opportunityId', 'opportunity'], ['assignmentIds', 'assignments'], ['days', 'number', true]], STRETCH: [['opportunityId', 'opportunity'], ['assignmentIds', 'assignments'], ['pct', 'number', true]],
  PRICE: [['pct', 'number', true], ['serviceId', 'service'], ['assignmentIds', 'assignments'], ['includeContracted', 'bool']], EFFORT: [['pct', 'number', true], ['serviceId', 'service'], ['assignmentIds', 'assignments']],
  SCOPE: [['assignmentIds', 'assignments', true], ['pct', 'number', true]], PROBABILITY: [['opportunityId', 'opportunity'], ['assignmentIds', 'assignments'], ['probabilityPct', 'number', true]],
  HIRE: [['name', 'text', true], ['count', 'number'], ['skillIds', 'skills', true], ['level', 'number'], ['weeklyHours', 'number', true], ['start', 'date', true], ['monthlyFixedCost', 'money', true], ['costRate', 'money', true], ['rampUpWeeks', 'number']],
  FREELANCER: [['name', 'text', true], ['skillIds', 'skills', true], ['level', 'number'], ['weeklyHours', 'number', true], ['start', 'date', true], ['end', 'date'], ['rate', 'money', true]],
  REMOVE_RESOURCE: [['resourceId', 'resource', true], ['from', 'date', true]], OUTSOURCE: [['rate', 'money', true], ['serviceId', 'service'], ['skillId', 'skill'], ['assignmentIds', 'assignments']],
  LABOR_COST: [['pct', 'number', true], ['internal', 'bool'], ['external', 'bool']], OVERHEAD: [['pct', 'number', true]],
  PAYMENT_TERMS: [['days', 'number', true], ['clientId', 'client'], ['assignmentIds', 'assignments']], PAYMENT_DELAY: [['days', 'number', true], ['clientId', 'client'], ['assignmentIds', 'assignments']],
  STOP_SERVICE: [['serviceId', 'service', true], ['from', 'date']], OPENING_CASH: [['amount', 'money', true]],
  NEW_SERVICE: [['name', 'text', true], ['start', 'date', true], ['end', 'date', true], ['fixedFee', 'money', true], ['hours', 'number', true], ['skillId', 'skill'], ['probabilityPct', 'number'], ['externalRate', 'money']],
};
interface Scenario { id: string; name: string; description: string | null; status: string; mode: PortfolioMode; version: number; operations: Op[]; runs?: Run[] }
interface Run { id: string; kind: string; status: string; createdAt: string; runtimeMs: number | null; error: string | null; seed: number | null }
interface RunDetail extends Run { running: boolean; result: { metrics?: ScenarioMetrics; baselineMetrics?: ScenarioMetrics; comparison?: ScenarioComparisonRow[]; log?: { index: number; type: string; affected: number; note?: string }[] } & Partial<MonteCarloResult> & Partial<SensitivityResult> | null }
interface Lookups { opportunities: { id: string; opportunityNumber: string; title: string }[]; clients: { id: string; name: string }[] }

export function EngineScenariosPage() {
  const { t } = useTranslation();
  const can = useCan();
  const scenarios = useEngineQuery<Scenario[]>(['scenarios'], can('engine.scenarios.read') ? '/scenarios' : null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  if (!can('engine.scenarios.read')) return <><EngineNav /><NoAccess permission="engine.scenarios.read" /></>;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.scenarios.title')} subtitle={t('engine.scenarios.subtitle')} actions={can('engine.scenarios.create') && <Button onClick={() => setSelected('new')}><Plus size={14} />{t('engine.scenarios.new')}</Button>} />
      <div className="grid gap-3 xl:grid-cols-[300px_1fr]">
        <Section title={t('engine.scenarios.list')}>
          <QueryState query={scenarios} empty={!scenarios.data?.length}>
            <ul className="space-y-1">{scenarios.data?.map((s) => (
              <li key={s.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${selected === s.id ? 'bg-accent' : 'hover:bg-muted'}`}>
                <input type="checkbox" aria-label={t('engine.scenarios.compareSelect')} checked={compare.includes(s.id)} disabled={!compare.includes(s.id) && compare.length >= 3}
                  onChange={(e) => setCompare(e.target.checked ? [...compare, s.id] : compare.filter((x) => x !== s.id))} />
                <button className="flex-1 text-left" onClick={() => setSelected(s.id)}><div className="font-medium">{s.name}</div>
                  <div className="text-muted-foreground">{t(`engine.scenarioStatus.${s.status}`)} · {t(`engine.mode.${s.mode}`)} · {s.operations.length} ops</div></button>
              </li>))}</ul>
          </QueryState>
          {compare.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t('engine.scenarios.compareHint', { count: compare.length })}</p>}
        </Section>
        <div className="space-y-3">
          {selected && <ScenarioEditor key={selected} id={selected === 'new' ? null : selected} onSaved={setSelected} onDeleted={() => setSelected(null)} />}
          {compare.length > 0 && <Comparison ids={compare} names={Object.fromEntries((scenarios.data ?? []).map((s) => [s.id, s.name]))} />}
          {!selected && !compare.length && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('engine.scenarios.pick')}</p>}
        </div>
      </div>
    </>
  );
}

function OperationEditor({ op, onChange, onRemove, lookups }: { op: Op; onChange: (op: Op) => void; onRemove: () => void; lookups: { opps: Lookups['opportunities']; clients: Lookups['clients']; assignments: { id: string; title: string }[]; services: { id: string; code: string; name: string }[]; skills: { id: string; name: string }[]; resources: { id: string; displayName: string }[] } }) {
  const { t } = useTranslation();
  const set = (k: string, v: unknown) => { const next = { ...op }; if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; onChange(next); };
  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">{t(`engine.op.${op.type}`)}</span><button aria-label={t('engine.common.remove')} onClick={onRemove}><Trash2 size={13} /></button></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{OPS[op.type].map(([k, kind, required]) => {
        const label = `${t(`engine.opField.${k}`)}${required ? ' *' : ''}`; const v = op[k];
        if (kind === 'assignments' || kind === 'skills') {
          const items = kind === 'assignments' ? lookups.assignments.map((a) => ({ id: a.id, label: a.title })) : lookups.skills.map((s) => ({ id: s.id, label: s.name }));
          return <Field key={k} label={label} className="col-span-2"><select multiple className="h-20 w-full rounded-md border border-border bg-background text-xs" value={(v as string[]) ?? []}
            onChange={(e) => set(k, [...e.target.selectedOptions].map((o) => o.value))}>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></Field>;
        }
        if (['opportunity', 'service', 'client', 'skill', 'resource'].includes(kind)) {
          const items = kind === 'opportunity' ? lookups.opps.map((o) => ({ id: o.id, label: `${o.opportunityNumber} · ${o.title}` })) : kind === 'service' ? lookups.services.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))
            : kind === 'client' ? lookups.clients.map((c) => ({ id: c.id, label: c.name })) : kind === 'skill' ? lookups.skills.map((s) => ({ id: s.id, label: s.name })) : lookups.resources.map((r) => ({ id: r.id, label: r.displayName }));
          return <Field key={k} label={label}><SelectInput className="h-7 py-0 text-xs" value={(v as string) ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</SelectInput></Field>;
        }
        if (kind === 'bool') return <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!v} onChange={(e) => set(k, e.target.checked || undefined)} />{label}</label>;
        return <Field key={k} label={label}><TextInput className="h-7 py-0 text-xs" type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'} value={(v as string | number) ?? ''}
          onChange={(e) => set(k, kind === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} /></Field>;
      })}</div>
    </div>
  );
}

function ScenarioEditor({ id, onSaved, onDeleted }: { id: string | null; onSaved: (id: string) => void; onDeleted: () => void }) {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const detail = useEngineQuery<Scenario>(['scenario', id], id ? `/scenarios/${id}` : null);
  const refs = useEngineQuery<Lookups>(['references'], can('engine.portfolio.read') ? '/assignments/references' : null);
  const assignments = useEngineQuery<{ data: { id: string; title: string }[] }>(['assignments-all'], can('engine.portfolio.read') ? '/assignments?pageSize=200' : null);
  const services = useEngineQuery<{ id: string; code: string; name: string }[]>(['services'], '/services');
  const skills = useEngineQuery<{ id: string; name: string }[]>(['skills'], '/skills');
  const resources = useEngineQuery<{ id: string; displayName: string }[]>(['resources'], can('engine.resources.read') ? '/resources' : null);
  const [d, setD] = useState<Scenario | null>(id ? null : { id: '', name: '', description: '', status: 'DRAFT', mode: 'EXPECTED', version: 0, operations: [] });
  const [newOp, setNewOp] = useState('WIN');
  const [runId, setRunId] = useState<string | null>(null);
  const [mc, setMc] = useState({ iterations: 200, seed: 42 }); const [sens, setSens] = useState({ parameter: 'PRICE', steps: '-20,-10,0,10,20', includeContracted: false });
  useEffect(() => { if (detail.data) { setD(detail.data); if (!runId && detail.data.runs?.[0]) setRunId(detail.data.runs[0].id); } }, [detail.data, runId]);
  const run = useEngineQuery<RunDetail>(['run', runId], runId ? `/scenario-runs/${runId}` : null, { refetchInterval: pollWhileRunning });
  const save = useEngineMutation(() => { const x = d as Scenario; const body = { name: x.name, description: x.description || null, mode: x.mode, operations: x.operations, ...(id ? { expectedVersion: x.version } : {}) };
    return id ? enginePut<Scenario>(`/scenarios/${id}`, body) : enginePost<Scenario>('/scenarios', body); }, { success: t('common.saved'), onSuccess: (s) => onSaved(s.id) });
  const start = useEngineMutation((body: Record<string, unknown>) => enginePost<RunDetail>(`/scenarios/${id}/runs`, body), { onSuccess: (r) => setRunId(r.id) });
  const cancel = useEngineMutation(() => enginePost(`/scenario-runs/${runId}/cancel`));
  const verify = useEngineMutation(() => enginePost<{ identical: boolean }>(`/scenario-runs/${runId}/verify`), { onSuccess: (r) => alert(r.identical ? t('engine.scenarios.reproducible') : t('engine.scenarios.notReproducible')) });
  const duplicate = useEngineMutation(() => enginePost<Scenario>(`/scenarios/${id}/duplicate`), { onSuccess: (s) => onSaved(s.id) });
  const status = useEngineMutation((s: string) => enginePost(`/scenarios/${id}/status`, { status: s }), { success: t('common.saved') });
  const remove = useEngineMutation(() => engineDelete(`/scenarios/${id}`), { onSuccess: onDeleted });
  if (!d) return <QueryState query={detail}><span /></QueryState>;
  const locked = ['APPROVED', 'ARCHIVED'].includes(d.status) || !can(id ? 'engine.scenarios.update' : 'engine.scenarios.create');
  const lookups = { opps: refs.data?.opportunities ?? [], clients: refs.data?.clients ?? [], assignments: assignments.data?.data ?? [], services: services.data ?? [], skills: skills.data ?? [], resources: resources.data ?? [] };
  const rd = run.data; const res = rd?.result;
  return (
    <>
      <Section title={id ? d.name : t('engine.scenarios.new')} actions={id && <div className="flex gap-1">
        {can('engine.scenarios.create') && <Button size="sm" variant="secondary" onClick={() => duplicate.mutate(undefined)}><Copy size={12} />{t('engine.scenarios.duplicate')}</Button>}
        {can('engine.scenarios.approve') && d.status !== 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => status.mutate('APPROVED')}>{t('engine.scenarios.approve')}</Button>}
        {d.status !== 'ARCHIVED' && can('engine.scenarios.update') && <Button size="sm" variant="secondary" onClick={() => status.mutate('ARCHIVED')}>{t('engine.common.archive')}</Button>}
        {can('engine.scenarios.delete') && <Button size="sm" variant="destructive" onClick={() => confirm(t('engine.scenarios.deleteConfirm')) && remove.mutate(undefined)}><Trash2 size={12} /></Button>}</div>}>
        <fieldset disabled={locked} className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('engine.col.name')} required className="col-span-2"><TextInput value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label={t('engine.filters.mode')}><SelectInput value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value as PortfolioMode })}>{(['CONTRACTED', 'EXPECTED', 'ALL_WIN'] as const).map((m) => <option key={m} value={m}>{t(`engine.mode.${m}`)}</option>)}</SelectInput></Field>
          </div>
          <Field label={t('engine.services.description')}><TextArea rows={2} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
          <div className="space-y-2">{d.operations.map((op, i) => <OperationEditor key={i} op={op} lookups={lookups} onChange={(o) => setD({ ...d, operations: d.operations.map((x, j) => (j === i ? o : x)) })}
            onRemove={() => setD({ ...d, operations: d.operations.filter((_, j) => j !== i) })} />)}</div>
          <div className="flex gap-2"><SelectInput className="h-8 w-64 text-xs" value={newOp} onChange={(e) => setNewOp(e.target.value)}>{Object.keys(OPS).map((k) => <option key={k} value={k}>{t(`engine.op.${k}`)}</option>)}</SelectInput>
            <Button variant="secondary" onClick={() => setD({ ...d, operations: [...d.operations, { type: newOp }] })}><Plus size={13} />{t('engine.scenarios.addOp')}</Button>
            <Button onClick={() => save.mutate(undefined)} disabled={!d.name}>{t('common.save', { defaultValue: 'Save' })}</Button></div>
          {locked && d.status === 'APPROVED' && <p className="text-[11px] text-muted-foreground">{t('engine.scenarios.lockedHint')}</p>}
        </fieldset>
      </Section>
      {id && <Section title={t('engine.scenarios.runs')}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Button size="sm" onClick={() => start.mutate({ kind: 'DETERMINISTIC' })}><Play size={12} />{t('engine.scenarios.runDeterministic')}</Button>
          <span className="mx-2 h-6 w-px bg-border" />
          <Field label={t('engine.scenarios.iterations')}><TextInput className="h-7 w-20 py-0 text-xs" type="number" value={mc.iterations} onChange={(e) => setMc({ ...mc, iterations: Number(e.target.value) })} /></Field>
          <Field label={t('engine.scenarios.seed')}><TextInput className="h-7 w-24 py-0 text-xs" type="number" value={mc.seed} onChange={(e) => setMc({ ...mc, seed: Number(e.target.value) })} /></Field>
          <Button size="sm" variant="secondary" onClick={() => start.mutate({ kind: 'MONTE_CARLO', ...mc })}>{t('engine.scenarios.runMonteCarlo')}</Button>
          <span className="mx-2 h-6 w-px bg-border" />
          <Field label={t('engine.scenarios.parameter')}><SelectInput className="h-7 w-36 py-0 text-xs" value={sens.parameter} onChange={(e) => setSens({ ...sens, parameter: e.target.value })}>
            {['PRICE', 'HOURS', 'INTERNAL_RATE', 'EXTERNAL_RATE', 'DURATION', 'PROBABILITY', 'PAYMENT_DELAY'].map((p) => <option key={p} value={p}>{t(`engine.sensitivity.${p}`)}</option>)}</SelectInput></Field>
          <Field label={t('engine.scenarios.steps')}><TextInput className="h-7 w-36 py-0 text-xs" value={sens.steps} onChange={(e) => setSens({ ...sens, steps: e.target.value })} /></Field>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={sens.includeContracted} onChange={(e) => setSens({ ...sens, includeContracted: e.target.checked })} />{t('engine.opField.includeContracted')}</label>
          <Button size="sm" variant="secondary" onClick={() => start.mutate({ kind: 'SENSITIVITY', parameter: sens.parameter, steps: sens.steps.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)), includeContracted: sens.includeContracted })}>{t('engine.scenarios.runSensitivity')}</Button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1 text-[11px]">{detail.data?.runs?.map((r) => <button key={r.id} className={`rounded border px-1.5 py-0.5 ${r.id === runId ? 'border-primary' : 'border-border'}`} onClick={() => setRunId(r.id)}>
          {t(`engine.runKind.${r.kind}`)} · {t(`engine.runStatus.${r.status}`)} · {fmt.dateTime(r.createdAt)}</button>)}</div>
        {rd && <div>
          <div className="mb-2 flex items-center gap-2 text-xs"><BasisBadge basis="SIMULATED" /><span>{t(`engine.runKind.${rd.kind}`)} · {t(`engine.runStatus.${rd.status}`)}{rd.runtimeMs !== null && ` · ${rd.runtimeMs} ms`}{rd.seed !== null && ` · seed ${rd.seed}`}</span>
            {rd.running && <Button size="sm" variant="secondary" onClick={() => cancel.mutate(undefined)}><Square size={11} />{t('engine.common.cancel')}</Button>}
            {rd.kind === 'DETERMINISTIC' && rd.status === 'SUCCEEDED' && <Button size="sm" variant="ghost" onClick={() => verify.mutate(undefined)}>{t('engine.scenarios.verify')}</Button>}</div>
          {rd.error && <p className="text-xs text-destructive">{rd.error}</p>}
          {res?.comparison && <ComparisonTable rows={res.comparison} names={[d.name]} />}
          {res?.log && <p className="mt-2 text-[11px] text-muted-foreground">{res.log.map((l) => `${t(`engine.op.${l.type}`)}: ${l.affected}${l.note ? ` (${l.note})` : ''}`).join(' · ')}</p>}
          {rd.kind === 'MONTE_CARLO' && res?.revenue && <MonteCarloView r={res as unknown as MonteCarloResult} />}
          {rd.kind === 'SENSITIVITY' && res?.steps && <SensitivityView r={res as unknown as SensitivityResult} />}
        </div>}
      </Section>}
    </>
  );
}

function ComparisonTable({ rows, names }: { rows: ScenarioComparisonRow[]; names: string[] }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const show = (key: string, v: string | number | null) => v === null ? '—' : typeof v === 'string' ? fmt.moneyShort(v) : ['marginPct', 'topClientSharePct'].includes(key) ? fmt.pct(v) : key === 'utilization' ? fmt.pct(v, true) : fmt.num(v);
  return (
    <Table head={[t('engine.col.metric'), t('engine.scenarios.baseline'), ...names.flatMap((n) => [n, 'Δ'])]}>
      {rows.map((r) => <tr key={r.key}><td className={td}>{t(`engine.metric.${r.key}`)}</td><td className={tdNum}>{show(r.key, r.baseline)}</td>
        {r.values.map((v, i) => { const delta = r.deltas[i]; const n = delta === null ? 0 : Number(delta); return [<td key={`v${i}`} className={tdNum}>{show(r.key, v)}</td>,
          <td key={`d${i}`} className={`${tdNum} ${n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{delta === null ? '—' : `${n > 0 ? '+' : ''}${show(r.key, delta)}`}</td>]; })}</tr>)}
    </Table>
  );
}

function MonteCarloView({ r }: { r: MonteCarloResult }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const row = (k: string, d: MonteCarloResult['revenue'], money = true) => <tr key={k}><td className={td}>{t(`engine.metric.${k}`)}</td>{[d.p5, d.p10, d.p50, d.mean, d.p90, d.p95].map((v, i) => <td key={i} className={tdNum}>{money ? fmt.compact(v) : fmt.num(v)}</td>)}</tr>;
  return (
    <div className="mt-2 space-y-2">
      <Table head={[t('engine.col.metric'), 'P5', 'P10', 'P50', t('engine.scenarios.mean'), 'P90', 'P95']}>
        {row('revenue', r.revenue)}{row('contribution', r.contribution)}{row('operatingResult', r.operatingResult)}{row('minCash', r.minCash)}{row('shortageHours', r.shortageHours, false)}
      </Table>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[['probabilityNegativeCash', r.probabilityNegativeCash], ['probabilityBelowReserve', r.probabilityBelowReserve], ['probabilityCapacityOverload', r.probabilityCapacityOverload], ['probabilityNegativeOperatingResult', r.probabilityNegativeOperatingResult]].map(([k, v]) => (
        <div key={k as string} className="rounded-md border border-border p-2 text-xs"><div className="text-muted-foreground">{t(`engine.metric.${k}`)}</div><div className="text-base font-semibold">{fmt.pct(v as number, true)}</div></div>))}</div>
      <ul className="list-disc pl-4 text-[11px] text-muted-foreground">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}

function SensitivityView({ r }: { r: SensitivityResult }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const unit = r.parameter === 'PAYMENT_DELAY' ? ' d' : ' %';
  return (
    <div className="mt-2 space-y-2">
      <LineChart labels={r.steps.map((s) => `${s.pct}${unit}`)} format={(v) => fmt.compact(v)} series={[
        { label: t('engine.metric.contribution'), color: SERIES[0], values: r.steps.map((s) => Number(s.metrics.contribution)) },
        { label: t('engine.metric.operatingResult'), color: SERIES[1], values: r.steps.map((s) => Number(s.metrics.operatingResult)) },
        { label: t('engine.metric.minCash'), color: SERIES[2], values: r.steps.map((s) => Number(s.metrics.minCash)) }]} reference={{ value: 0, label: '0' }} />
      <Table head={[t(`engine.sensitivity.${r.parameter}`), t('engine.metric.revenue'), t('engine.metric.contribution'), t('engine.metric.operatingResult'), t('engine.metric.minCash'), t('engine.metric.shortageHours')]}>
        {r.steps.map((s) => <tr key={s.pct}><td className={td}>{s.pct}{unit}</td><td className={tdNum}>{fmt.moneyShort(s.metrics.revenue)}</td><td className={tdNum}>{fmt.moneyShort(s.metrics.contribution)}</td>
          <td className={tdNum}>{fmt.moneyShort(s.metrics.operatingResult)}</td><td className={tdNum}>{fmt.moneyShort(s.metrics.minCash)}</td><td className={tdNum}>{fmt.hours(s.metrics.shortageHours)}</td></tr>)}
      </Table>
      <ul className="text-xs">{r.breakEven.map((b) => <li key={b.metric}><b>{t('engine.scenarios.breakEven')} {t(`engine.metric.${b.metric}`)}:</b> {b.pct === null ? '—' : `${b.pct}${unit}`} <span className="text-muted-foreground">({b.note})</span></li>)}</ul>
    </div>
  );
}

function Comparison({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const [mode, setMode] = useState<PortfolioMode>('EXPECTED');
  const [data, setData] = useState<{ rows: ScenarioComparisonRow[]; cash: { key: string; closing: string }[][]; scenarios: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; setBusy(true); setError(null);
    enginePost<typeof data>('/scenario-compare', { scenarioIds: ids, mode }).then((r) => { if (live) setData(r); }).catch((e: Error) => live && setError(e.message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [ids, mode]);
  return (
    <Section title={<span className="flex items-center gap-2">{t('engine.scenarios.comparison')} <BasisBadge basis="SIMULATED" /></span>} actions={<SelectInput className="h-7 w-44 py-0 text-xs" value={mode} onChange={(e) => setMode(e.target.value as PortfolioMode)}>
      {(['CONTRACTED', 'EXPECTED', 'ALL_WIN'] as const).map((m) => <option key={m} value={m}>{t(`engine.mode.${m}`)}</option>)}</SelectInput>}>
      {busy && <p className="text-xs text-muted-foreground">{t('engine.common.calculating')}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {data && <>
        <LineChart labels={data.cash[0].map((m) => fmt.month(m.key))} format={(v) => fmt.compact(v)} reference={{ value: 0, label: '0' }}
          series={[{ label: t('engine.scenarios.baseline'), color: 'hsl(var(--muted-foreground))', dashed: true, values: data.cash[0].map((m) => Number(m.closing)) },
            ...data.scenarios.map((s, i) => ({ label: s.name, color: SERIES[i], values: data.cash[i + 1].map((m) => Number(m.closing)) }))]} />
        <ComparisonTable rows={data.rows} names={data.scenarios.map((s) => names[s.id] ?? s.name)} />
      </>}
    </Section>
  );
}
