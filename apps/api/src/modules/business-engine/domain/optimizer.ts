import type {
  BindingConstraint, EngineSnapshot, OptimizationCandidateResult, OptimizationObjective, OptimizationResult, PortfolioResult, ScenarioOperation, SnapshotAssignment, SolverStatus,
} from '../../../../../../packages/shared/src/business-engine';
import { computePortfolio, SENIORITY_LEVEL } from './portfolio';
import { applyOperations, scenarioMetrics } from './scenario';
import { dec, round } from './money';

/**
 * Portfolio optimization as a mixed-integer linear program solved by HiGHS.
 *
 * Decision variables: one binary per (opportunity, delivery variant) — as planned, externally sourced,
 * or shifted within the permissible window — plus optional hire binaries. Contracted work is part of the
 * fixed baseline and can never be deselected.
 *
 * Constraints (monthly): named-resource capacity, skill-pool capacity, total internal capacity, minimum
 * closing cash (reserve − financing limit), one variant per opportunity, mutually exclusive groups,
 * mandatory selections. Multi-skill capacity is represented by per-skill and total constraints — a
 * necessary-condition relaxation — so the chosen portfolio is re-verified with the full allocation engine.
 */

export type HighsSolver = { solve: (lp: string, options?: Record<string, unknown>) => HighsSolution };
interface HighsSolution {
  Status: string; ObjectiveValue: number;
  Columns: Record<string, { Primal: number; Dual?: number; Name: string }>;
  Rows: { Name: string; Primal: number; Dual?: number; Lower: number | null; Upper: number | null }[];
}
export type HighsLoader = () => Promise<HighsSolver>;

export interface OptimizationInput {
  snapshot: EngineSnapshot;
  objectiveWeights?: Partial<Record<OptimizationObjective, number>>;
  timeLimitSeconds?: number;
  allowExternalSourcing?: boolean;
  allowShifts?: boolean;
  cashConstraint?: boolean;
  basis?: 'IF_WON' | 'EXPECTED';
  hireOptions?: Extract<ScenarioOperation, { type: 'HIRE' }>[];
  mandatoryOpportunityKeys?: string[];
  excludedOpportunityKeys?: string[];
}

interface Variant {
  name: string; label: string; ops: ScenarioOperation[]; revenue: number; contribution: number; operating: number; endCash: number;
  closing: number[]; resourceHours: Map<string, number[]>; skillHours: Map<string, number[]>; internalTotal: number[];
}
interface Candidate { key: string; title: string; opportunityId: string | null; assignments: SnapshotAssignment[]; group: string | null; probability: number; risk: number | null; strategic: number | null; variants: Variant[] }

const fmt = (value: number) => (Math.abs(value) < 1e-9 ? '0' : value.toFixed(6));
const monthOfWeek = (r: PortfolioResult) => r.weeks.map((w) => r.months.findIndex((m) => w.start >= m.start && w.start <= m.end));

function profile(r: PortfolioResult) {
  const wm = monthOfWeek(r); const M = r.months.length;
  const toMonths = (weeks: number[]) => { const out = new Array<number>(M).fill(0); weeks.forEach((h, w) => { if (wm[w] >= 0) out[wm[w]] += h; }); return out; };
  const resourceHours = new Map<string, number[]>(); const internalTotal = new Array<number>(M).fill(0);
  for (const res of r.capacity.resources) {
    const months = toMonths(res.weeks.map((x) => x.planned));
    if (months.some((h) => h > 1e-6)) resourceHours.set(res.id, months);
    if (res.internal) months.forEach((h, m) => { internalTotal[m] += h; });
  }
  const skillHours = new Map<string, number[]>();
  for (const sk of r.capacity.skills) {
    const months = toMonths(sk.weeks.map((x) => x.demand));
    skillHours.set(sk.skillId ?? '*', months); months.forEach((h, m) => { internalTotal[m] += h; });
  }
  return { resourceHours, skillHours, internalTotal };
}

export async function optimize(input: OptimizationInput, loadHighs: HighsLoader, shouldStop: () => boolean = () => false): Promise<OptimizationResult> {
  const started = Date.now();
  const snapshot = input.snapshot; const config = snapshot.config;
  const weights = input.objectiveWeights ?? config.optimization.objectiveWeights;
  const basis = input.basis ?? config.optimization.basis;
  const diagnostics: string[] = [];
  const approximations = [
    'Capacity is checked monthly per named resource, per skill pool and in total; multi-skilled resources make the skill constraints a relaxation, so the result is re-verified with the full weekly allocation.',
    'Cash is constrained on month-end closing balances; intra-month dips are reported by the verification run.',
    'Variant coefficients use standard cost rates for unnamed internal demand.',
    ...(weights.RISK_ADJUSTED_VALUE ? ['Risk-adjusted value = contribution × award probability × (1 − 0.1 × (service risk score − 1)).'] : []),
  ];

  // Baseline: contracted work only (fixed, never optional).
  const pipelineIds = snapshot.assignments.filter((a) => a.commitment === 'PIPELINE').map((a) => a.id);
  const baseSnap = applyOperations(snapshot, pipelineIds.length ? [{ type: 'LOSE', assignmentIds: pipelineIds }] : []).snapshot;
  const base = computePortfolio(baseSnap, 'CONTRACTED', { calculatedAt: 'optimizer-base' });
  const M = base.months.length;
  const wm = monthOfWeek(base);
  const baseClosing = base.cash.months.map((m) => Number(m.closing));
  const freeByResource = new Map<string, number[]>();
  const baselineOverloads: OptimizationResult['baselineCapacityOverloads'] = [];
  for (const res of base.capacity.resources) {
    const free = new Array<number>(M).fill(0);
    res.weeks.forEach((cell, w) => { if (wm[w] >= 0) free[wm[w]] += cell.available - cell.planned; });
    free.forEach((value, m) => { if (value < -0.01) baselineOverloads.push({ label: res.name, periodKey: base.months[m].key, excessHours: round(-value) }); });
    freeByResource.set(res.id, free.map((value) => Math.max(0, value)));
  }
  for (const b of base.capacity.bottlenecks) if (b.kind === 'SKILL_SHORTAGE') baselineOverloads.push({ label: `Skill ${b.name}`, periodKey: b.periodKey, excessHours: b.excessHours });
  if (baselineOverloads.length) diagnostics.push('Contracted work alone exceeds capacity in some periods; those periods admit no additional internal demand.');

  // Candidates: pipeline assignments grouped per opportunity.
  const groups = new Map<string, SnapshotAssignment[]>();
  for (const a of snapshot.assignments) if (a.commitment === 'PIPELINE') { const key = a.opportunityId ?? a.id; groups.set(key, [...(groups.get(key) ?? []), a]); }
  const excluded = new Set(input.excludedOpportunityKeys ?? []);
  const mandatory = new Set(input.mandatoryOpportunityKeys ?? []);
  const evaluate = (assignments: SnapshotAssignment[], ops: ScenarioOperation[], name: string, label: string): Variant => {
    const ids = assignments.map((a) => a.id);
    const snap = applyOperations({ ...snapshot, assignments: structuredClone(assignments), openReceivables: [], openPayables: [], openingCash: '0.00' }, [{ type: 'WIN', assignmentIds: ids }, ...ops]).snapshot;
    const r = computePortfolio(snap, 'CONTRACTED', { calculatedAt: 'optimizer-variant', standardCosting: true, excludeCompanyCosts: true });
    const p = profile(r);
    return { name, label, ops, revenue: Number(r.totals.revenue), contribution: r.assignments.reduce((s, x) => s + Number(x.contribution), 0),
      operating: r.pnl.reduce((s, x) => s + Number(x.revenue) - Number(x.externalCost), 0), endCash: Number(r.cash.endBalance),
      closing: r.cash.months.map((m) => Number(m.closing)), ...p };
  };
  const candidates: Candidate[] = [];
  for (const [key, assignments] of groups) {
    if (excluded.has(key)) continue;
    const ids = assignments.map((a) => a.id);
    const variants: Variant[] = [evaluate(assignments, [], 'PLAN', 'As planned')];
    const pooled = assignments.some((a) => a.demand.some((d) => d.sourcing === 'INTERNAL' && !d.resourceId));
    if ((input.allowExternalSourcing ?? config.optimization.allowExternalSourcing) && pooled && assignments.every((a) => a.externalDeliveryAllowed)) {
      const rate = dec(config.rates.defaultExternalRate).times(1 + config.optimization.externalMarkupPct / 100).toFixed(2);
      variants.push(evaluate(assignments, [{ type: 'OUTSOURCE', rate, assignmentIds: ids }], 'EXTERNAL', `External delivery at ${rate}/h`));
    }
    const shiftWeeks = Math.min(...assignments.map((a) => a.shiftableWeeks));
    if ((input.allowShifts ?? true) && shiftWeeks > 0) {
      for (const weeks of [...new Set([Math.ceil(shiftWeeks / 2), shiftWeeks])]) variants.push(evaluate(assignments, [{ type: 'SHIFT', days: weeks * 7, assignmentIds: ids }], `SHIFT_${weeks}W`, `Start ${weeks} weeks later`));
    }
    const first = assignments[0];
    candidates.push({ key, title: assignments.length > 1 ? `${first.clientName}: ${assignments.map((a) => a.title).join(' + ')}` : first.title, opportunityId: first.opportunityId,
      assignments, group: assignments.find((a) => a.exclusiveGroup)?.exclusiveGroup ?? null, probability: Math.min(...assignments.map((a) => a.probability)),
      risk: assignments.reduce<number | null>((m, a) => (a.riskScore === null ? m : Math.max(m ?? 0, a.riskScore)), null),
      strategic: assignments.reduce<number | null>((m, a) => (a.strategicScore === null ? m : Math.max(m ?? 0, a.strategicScore)), null), variants });
    if (shouldStop()) break;
  }
  const hires = (input.hireOptions ?? []).map((op, index) => {
    const snap = applyOperations({ ...snapshot, assignments: [], openReceivables: [], openPayables: [], openingCash: '0.00', resources: [], config: { ...config, overhead: { ...config.overhead, monthly: [] } } }, [op]).snapshot;
    const r = computePortfolio(snap, 'CONTRACTED', { calculatedAt: 'optimizer-hire' });
    const cap = r.capacity.resources.map((res) => { const out = new Array<number>(M).fill(0); res.weeks.forEach((c, w) => { if (wm[w] >= 0) out[wm[w]] += c.available; }); return out; })
      .reduce((acc, x) => acc.map((v, i) => v + x[i]), new Array<number>(M).fill(0));
    return { key: `HIRE_${index}`, op, label: `${op.name}${(op.count ?? 1) > 1 ? ` ×${op.count}` : ''}`, capacity: cap, closing: r.cash.months.map((m) => Number(m.closing)),
      cost: -Number(r.cash.endBalance), skills: op.skillIds, level: op.level ?? 3 };
  });

  // Objective coefficients, normalised per objective so weights are comparable.
  const objectiveKeys = (Object.keys(weights) as OptimizationObjective[]).filter((k) => (weights[k] ?? 0) > 0);
  const p = (c: Candidate) => (basis === 'EXPECTED' ? c.probability : 1);
  const coefficient = (c: Candidate, v: Variant, k: OptimizationObjective): number => {
    switch (k) {
      case 'CONTRIBUTION': return v.contribution * p(c);
      case 'OPERATING_PROFIT': return v.operating * p(c);
      case 'CASH': return v.endCash * p(c);
      case 'RISK_ADJUSTED_VALUE': return v.contribution * c.probability * (c.risk ? Math.max(0, 1 - 0.1 * (c.risk - 1)) : 1);
      case 'STRATEGIC': return v.revenue * (c.strategic ?? 0) / 5 * p(c);
      case 'PEAK_WORKING_CAPITAL': return 0; // handled through the auxiliary peak variable
    }
  };
  const hireCoefficient = (h: (typeof hires)[number], k: OptimizationObjective) => (k === 'PEAK_WORKING_CAPITAL' || k === 'STRATEGIC' ? 0 : -h.cost);
  const scales = new Map<OptimizationObjective, number>(objectiveKeys.map((k) => {
    const values = [...candidates.flatMap((c) => c.variants.map((v) => coefficient(c, v, k))), ...hires.map((h) => hireCoefficient(h, k))];
    const scaleValue = k === 'PEAK_WORKING_CAPITAL' ? Math.max(1, ...baseClosing.map((x) => Math.abs(x))) : Math.max(1, ...values.map(Math.abs));
    return [k, scaleValue];
  }));
  const combined = (c: Candidate, v: Variant) => objectiveKeys.reduce((s, k) => s + (weights[k] ?? 0) * coefficient(c, v, k) / (scales.get(k) as number), 0);
  const combinedHire = (h: (typeof hires)[number]) => objectiveKeys.reduce((s, k) => s + (weights[k] ?? 0) * hireCoefficient(h, k) / (scales.get(k) as number), 0);

  // Build the LP model.
  const vars: { name: string; c: Candidate; v: Variant; index: number }[] = [];
  candidates.forEach((c) => c.variants.forEach((v, index) => vars.push({ name: `x${vars.length}`, c, v, index })));
  const hireVars = hires.map((h, i) => ({ name: `h${i}`, h }));
  const rows: { name: string; label: string; kind: BindingConstraint['kind']; period: string | null; terms: [string, number][]; sense: '<=' | '>=' | '='; rhs: number }[] = [];
  const opening = Number(snapshot.openingCash);
  // capacity per named resource
  for (const res of base.capacity.resources) {
    const free = freeByResource.get(res.id) as number[];
    for (let m = 0; m < M; m++) {
      const terms = vars.map((x) => [x.name, x.v.resourceHours.get(res.id)?.[m] ?? 0] as [string, number]).filter(([, h]) => h > 1e-6);
      if (terms.length) rows.push({ name: `r${rows.length}`, label: `${res.name} capacity`, kind: 'CAPACITY', period: base.months[m].key, terms, sense: '<=', rhs: free[m] });
    }
  }
  // skill pools
  const skillIds = new Set(vars.flatMap((x) => [...x.v.skillHours.keys()]));
  const children = new Map<string, string[]>(); for (const s of snapshot.skills) if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s.id]);
  const desc = (id: string) => { const out = new Set([id]); const st = [id]; while (st.length) for (const c of children.get(st.pop() as string) ?? []) if (!out.has(c)) { out.add(c); st.push(c); } return out; };
  for (const skill of skillIds) {
    const allowed = skill === '*' ? null : desc(skill);
    const minLevel = Math.min(...vars.flatMap((x) => x.c.assignments.flatMap((a) => a.demand.filter((d) => (d.skillId ?? '*') === skill).map((d) => SENIORITY_LEVEL[d.seniority] ?? 1))), 5);
    const qualified = snapshot.resources.filter((r) => !allowed || r.skills.some((s) => allowed.has(s.skillId) && s.level >= minLevel));
    const qualifiedHires = hireVars.filter((hv) => !allowed || (hv.h.skills.some((s) => allowed.has(s)) && hv.h.level >= minLevel));
    const name = skill === '*' ? 'Any skill' : snapshot.skills.find((s) => s.id === skill)?.name ?? skill;
    for (let m = 0; m < M; m++) {
      const terms = vars.map((x) => [x.name, x.v.skillHours.get(skill)?.[m] ?? 0] as [string, number]).filter(([, h]) => h > 1e-6);
      if (!terms.length) continue;
      for (const hv of qualifiedHires) terms.push([hv.name, -hv.h.capacity[m]]);
      rows.push({ name: `s${rows.length}`, label: `Skill pool ${name}`, kind: 'CAPACITY', period: base.months[m].key, terms, sense: '<=',
        rhs: qualified.reduce((s, r) => s + (freeByResource.get(r.id)?.[m] ?? 0), 0) });
    }
  }
  // total internal capacity
  for (let m = 0; m < M; m++) {
    const terms = vars.map((x) => [x.name, x.v.internalTotal[m]] as [string, number]).filter(([, h]) => h > 1e-6);
    if (!terms.length) continue;
    for (const hv of hireVars) terms.push([hv.name, -hv.h.capacity[m]]);
    rows.push({ name: `t${rows.length}`, label: 'Total internal capacity', kind: 'TOTAL_CAPACITY', period: base.months[m].key, terms, sense: '<=',
      rhs: base.capacity.resources.filter((r) => r.internal).reduce((s, r) => s + (freeByResource.get(r.id)?.[m] ?? 0), 0) });
  }
  // cash floor on month-end closing balances
  const floor = Number(config.cash.minCashReserve) - Number(config.cash.financingLimit);
  const cashOn = input.cashConstraint ?? config.optimization.cashConstraint;
  if (cashOn) {
    const breached = baseClosing.map((x, m) => (x < floor - 0.005 ? base.months[m].key : null)).filter(Boolean);
    if (breached.length) diagnostics.push(`Contracted work alone breaches the cash floor (${floor.toFixed(2)}) in ${breached.join(', ')}; the cash constraint can only be met if selections improve those months.`);
    for (let m = 0; m < M; m++) {
      const terms = [...vars.map((x) => [x.name, x.v.closing[m]] as [string, number]), ...hireVars.map((hv) => [hv.name, hv.h.closing[m]] as [string, number])].filter(([, v]) => Math.abs(v) > 0.005);
      rows.push({ name: `cash${m}`, label: 'Minimum cash balance', kind: 'CASH', period: base.months[m].key, terms, sense: '>=', rhs: floor - baseClosing[m] });
    }
  }
  // one variant per opportunity; mandatory selections; exclusive groups
  candidates.forEach((c, ci) => {
    const terms = vars.filter((x) => x.c === c).map((x) => [x.name, 1] as [string, number]);
    rows.push({ name: `one${ci}`, label: `One variant: ${c.title}`, kind: 'EXCLUSIVE', period: null, terms, sense: mandatory.has(c.key) ? '=' : '<=', rhs: 1 });
  });
  const exclusive = new Map<string, Candidate[]>(); for (const c of candidates) if (c.group) exclusive.set(c.group, [...(exclusive.get(c.group) ?? []), c]);
  for (const [group, members] of exclusive) if (members.length > 1) rows.push({ name: `grp${rows.length}`, label: `Mutually exclusive: ${group}`, kind: 'EXCLUSIVE', period: null,
    terms: vars.filter((x) => members.includes(x.c)).map((x) => [x.name, 1]), sense: '<=', rhs: 1 });
  // peak working capital: P ≥ opening − closing_m (all m); objective −w·P/scale
  const peakWeight = weights.PEAK_WORKING_CAPITAL ?? 0;
  if (peakWeight > 0) for (let m = 0; m < M; m++) {
    rows.push({ name: `peak${m}`, label: 'Peak working capital', kind: 'CASH', period: base.months[m].key,
      terms: [['P', 1], ...vars.map((x) => [x.name, x.v.closing[m]] as [string, number]), ...hireVars.map((hv) => [hv.name, hv.h.closing[m]] as [string, number])], sense: '>=', rhs: opening - baseClosing[m] });
  }

  const objTerms = [...vars.map((x) => [x.name, combined(x.c, x.v)] as [string, number]), ...hireVars.map((hv) => [hv.name, combinedHire(hv.h)] as [string, number]),
    ...(peakWeight > 0 ? [['P', -peakWeight / (scales.get('PEAK_WORKING_CAPITAL') as number)] as [string, number]] : [])];
  const expr = (terms: [string, number][]) => terms.length ? terms.map(([n, c]) => `${c < 0 ? '-' : '+'} ${fmt(Math.abs(c))} ${n}`).join(' ') : '0 x_dummy';
  const binaries = [...vars.map((x) => x.name), ...hireVars.map((h) => h.name)];
  const lp = (integer: boolean) => [
    'Maximize', ` obj: ${objTerms.length ? expr(objTerms) : '0 x_dummy'}`, 'Subject To',
    ...rows.map((r) => ` ${r.name}: ${expr(r.terms)} ${r.sense} ${fmt(r.rhs)}`),
    'Bounds', ...binaries.map((b) => ` 0 <= ${b} <= 1`), ...(peakWeight > 0 ? [' P >= 0'] : []), ...(objTerms.length && binaries.length ? [] : [' x_dummy = 0']),
    ...(integer && binaries.length ? ['General', ` ${binaries.join(' ')}`] : []), 'End',
  ].join('\n');

  const result: OptimizationResult = {
    status: 'FAILED', solverStatus: 'NOT_RUN', solver: 'HiGHS (MILP, branch-and-cut)', runtimeMs: 0, objectiveValue: null, bound: null, gapPct: null, objectives: {},
    candidates: [], binding: [], baselineCapacityOverloads: baselineOverloads, verification: null, verificationShortageHours: null, diagnostics, variables: binaries.length, constraints: rows.length, approximations,
  };
  if (shouldStop()) { result.status = 'CANCELLED'; result.runtimeMs = Date.now() - started; return result; }
  if (!binaries.length) diagnostics.push('No optional opportunities or hire options to decide; the baseline is the only feasible portfolio.');

  const timeLimit = input.timeLimitSeconds ?? config.optimization.timeLimitSeconds;
  let mip: HighsSolution; let relax: HighsSolution | null = null;
  try {
    mip = (await loadHighs()).solve(lp(true), { time_limit: timeLimit, mip_rel_gap: 1e-6, output_flag: false });
    try { relax = (await loadHighs()).solve(lp(false), { time_limit: timeLimit, output_flag: false }); } catch { diagnostics.push('LP relaxation failed; no bound or shadow prices available.'); }
  } catch (error) {
    result.solverStatus = error instanceof Error ? error.message : String(error); result.runtimeMs = Date.now() - started; return result;
  }
  result.solverStatus = mip.Status;
  const hasSolution = Object.values(mip.Columns ?? {}).length > 0 && Number.isFinite(mip.ObjectiveValue);
  const mapped: SolverStatus = mip.Status === 'Optimal' ? 'OPTIMAL'
    : mip.Status === 'Infeasible' ? 'INFEASIBLE'
    : /time limit/i.test(mip.Status) ? (hasSolution ? 'FEASIBLE' : 'TIMED_OUT')
    : hasSolution && /limit|interrupt/i.test(mip.Status) ? 'FEASIBLE' : 'FAILED';
  result.status = mapped;
  if (mapped === 'INFEASIBLE') diagnostics.push('No portfolio satisfies all hard constraints (see baseline overloads and cash diagnostics). Relax the cash constraint or financing limit, or add capacity options.');
  if (mapped === 'FEASIBLE') diagnostics.push(`Time limit of ${timeLimit}s reached: the solution is feasible but not proven optimal.`);
  if (mapped === 'OPTIMAL' || mapped === 'FEASIBLE') {
    const value = (n: string) => mip.Columns[n]?.Primal ?? 0;
    result.objectiveValue = round(mip.ObjectiveValue, 6);
    if (relax && relax.Status === 'Optimal') {
      result.bound = round(relax.ObjectiveValue, 6);
      result.gapPct = mapped === 'OPTIMAL' ? 0 : round(Math.abs(relax.ObjectiveValue - mip.ObjectiveValue) / Math.max(1e-9, Math.abs(relax.ObjectiveValue)) * 100, 4);
    }
    const chosen = vars.filter((x) => value(x.name) > 0.5);
    const chosenHires = hireVars.filter((h) => value(h.name) > 0.5);
    for (const k of objectiveKeys) result.objectives[k] = round(chosen.reduce((s, x) => s + coefficient(x.c, x.v, k), 0) + chosenHires.reduce((s, h) => s + hireCoefficient(h.h, k), 0), 2);
    const relaxRows = new Map((relax?.Rows ?? []).map((r) => [r.Name, r]));
    result.binding = rows.filter((r) => r.kind !== 'EXCLUSIVE').map((r) => {
      const lhs = r.terms.reduce((s, [n, c]) => s + c * value(n), 0);
      const slack = r.sense === '<=' ? r.rhs - lhs : lhs - r.rhs;
      return { r, slack };
    }).filter(({ slack }) => slack < 1e-3).map(({ r, slack }) => ({ name: r.name, label: r.label, kind: r.kind, periodKey: r.period, shadowPrice: relaxRows.get(r.name)?.Dual ?? null, slack: round(slack, 4) }));
    const relaxCols = relax?.Columns ?? {};
    result.candidates = [
      ...candidates.map((c): OptimizationCandidateResult => {
        const options = vars.filter((x) => x.c === c);
        const sel = options.find((x) => value(x.name) > 0.5);
        const reasons: string[] = [];
        if (sel) {
          reasons.push(`Selected "${sel.v.label}": objective coefficient ${round(combined(c, sel.v), 6)}, contribution ${sel.v.contribution.toFixed(2)}.`);
          const better = options.filter((o) => o !== sel && combined(c, o.v) > combined(c, sel.v) + 1e-9);
          if (better.length) reasons.push(`Higher-value variant(s) ${better.map((o) => `"${o.v.label}"`).join(', ')} not chosen because of binding constraints.`);
        } else {
          const best = options.reduce((x, y) => (combined(c, y.v) > combined(c, x.v) ? y : x));
          if (combined(c, best.v) <= 1e-9) reasons.push('Not selected: no variant improves the objective.');
          const rival = c.group ? chosen.find((x) => x.c !== c && x.c.group === c.group) : undefined;
          if (rival) reasons.push(`Not selected: mutually exclusive with selected "${rival.c.title}" (group ${c.group}).`);
          const blocking = result.binding.filter((b) => rows.find((r) => r.name === b.name)?.terms.some(([n, coef]) => options.some((o) => o.name === n) && coef > 1e-6 && b.kind !== 'CASH') || (b.kind === 'CASH' && options.some((o) => (o.v.closing[base.months.findIndex((m) => m.key === b.periodKey)] ?? 0) < 0)));
          if (blocking.length) reasons.push(`Blocked by binding constraint(s): ${blocking.slice(0, 4).map((b) => `${b.label}${b.periodKey ? ` ${b.periodKey}` : ''}`).join('; ')}.`);
          if (!reasons.length) reasons.push('Not selected: a combination without it achieves a higher objective within the constraints.');
        }
        return { key: c.key, kind: 'OPPORTUNITY', title: c.title, opportunityId: c.opportunityId, assignmentIds: c.assignments.map((a) => a.id), selected: !!sel, variant: sel?.v.name ?? null,
          mandatory: mandatory.has(c.key), objectiveCoefficient: round(combined(c, (sel ?? options[0]).v), 6), revenue: (sel ?? options[0]).v.revenue.toFixed(2), contribution: (sel ?? options[0]).v.contribution.toFixed(2),
          reducedCost: relaxCols[(sel ?? options[0]).name]?.Dual ?? null, reasons, alternatives: options.map((o) => ({ variant: o.v.name, objectiveCoefficient: round(combined(c, o.v), 6) })) };
      }),
      ...hireVars.map((hv): OptimizationCandidateResult => {
        const selected = value(hv.name) > 0.5;
        return { key: hv.h.key, kind: 'HIRE', title: hv.h.label, opportunityId: null, assignmentIds: [], selected, variant: selected ? 'HIRE' : null, mandatory: false,
          objectiveCoefficient: round(combinedHire(hv.h), 6), revenue: '0.00', contribution: (-hv.h.cost).toFixed(2), reducedCost: relaxCols[hv.name]?.Dual ?? null,
          reasons: [selected ? `Hire selected: the added capacity enables selections worth more than its cost ${hv.h.cost.toFixed(2)} in the horizon.` : `Hire not selected: cost ${hv.h.cost.toFixed(2)} in the horizon exceeds the value of the capacity it would unlock.`],
          alternatives: [] };
      }),
    ];
    // Verification with the full engine (weekly allocation, intra-month cash).
    const winIds = chosen.flatMap((x) => x.c.assignments.map((a) => a.id));
    const loseIds = pipelineIds.filter((id) => !winIds.includes(id));
    const ops: ScenarioOperation[] = [...(loseIds.length ? [{ type: 'LOSE' as const, assignmentIds: loseIds }] : []), ...(winIds.length ? [{ type: 'WIN' as const, assignmentIds: winIds }] : []),
      ...chosen.flatMap((x) => x.v.ops), ...chosenHires.map((h) => h.h.op)];
    const verified = computePortfolio(applyOperations(snapshot, ops).snapshot, 'CONTRACTED', { calculatedAt: 'optimizer-verification' });
    result.verification = scenarioMetrics(verified);
    result.verificationShortageHours = verified.totals.shortageHours;
    const baseShortage = base.totals.shortageHours;
    if (verified.totals.shortageHours > baseShortage + 0.5) diagnostics.push(`Verification found ${round(verified.totals.shortageHours - baseShortage)} additional unfilled hours (weekly peaks or multi-skill effects not visible in the monthly model).`);
  }
  result.runtimeMs = Date.now() - started;
  return result;
}
