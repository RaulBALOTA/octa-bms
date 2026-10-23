import type {
  EngineSnapshot, PortfolioMode, PortfolioResult, ScenarioComparisonRow, ScenarioMetrics, ScenarioOperation, SensitivityParameter, SensitivityResult, SnapshotAssignment,
} from '../../../../../../packages/shared/src/business-engine';
import { addDays, toDay, fromDay } from './calendar';
import { computePortfolio } from './portfolio';
import { D, dec, money, sum } from './money';

/**
 * Scenario operations act on a deep copy of the input snapshot — live data is never touched.
 * Every operation is logged so results can explain what changed.
 */
export interface AppliedScenario { snapshot: EngineSnapshot; log: { index: number; type: string; affected: number; note?: string }[] }

const scale = (value: string | null, factor: number) => (value === null ? null : money(dec(value).times(new D(factor.toFixed(10)))));

const hasTarget = (op: { assignmentIds?: string[]; opportunityId?: string; serviceId?: string; clientId?: string }) =>
  !!(op.assignmentIds?.length || op.opportunityId || op.serviceId || op.clientId);

/** Targeted selection; an operation without any target matches nothing (never "everything"). */
function select(snapshot: EngineSnapshot, op: { assignmentIds?: string[]; opportunityId?: string; serviceId?: string; clientId?: string }): SnapshotAssignment[] {
  if (!hasTarget(op)) return [];
  return snapshot.assignments.filter((a) =>
    (!op.assignmentIds?.length || op.assignmentIds.includes(a.id)) && (!op.opportunityId || a.opportunityId === op.opportunityId)
    && (!op.serviceId || a.serviceId === op.serviceId) && (!op.clientId || a.clientId === op.clientId));
}

function shift(a: SnapshotAssignment, days: number) {
  a.start = addDays(a.start, days); a.end = addDays(a.end, days);
  for (const d of a.demand) { if (d.start) d.start = addDays(d.start, days); if (d.end) d.end = addDays(d.end, days); }
  for (const m of a.milestones) if (!m.invoiced) m.date = addDays(m.date, days);
}
function scaleFees(a: SnapshotAssignment, factor: number) {
  a.fixedFee = scale(a.fixedFee, factor); a.hourlyRate = scale(a.hourlyRate, factor); a.dailyRate = scale(a.dailyRate, factor);
  a.monthlyRetainer = scale(a.monthlyRetainer, factor);
  a.capexPercent = a.capexPercent === null ? null : dec(a.capexPercent).times(new D(factor.toFixed(10))).toDecimalPlaces(6).toString();
  for (const m of a.milestones) if (!m.invoiced) m.amount = money(dec(m.amount).times(new D(factor.toFixed(10))));
}
function scaleEffort(a: SnapshotAssignment, factor: number) {
  for (const d of a.demand) {
    const remaining = d.remainingHours ?? Math.max(0, d.hours - d.actualHours);
    d.remainingHours = remaining * factor; d.hours = d.actualHours + d.remainingHours;
  }
}

export function applyOperations(input: EngineSnapshot, operations: ScenarioOperation[]): AppliedScenario {
  const snapshot = structuredClone(input);
  const log: AppliedScenario['log'] = [];
  operations.forEach((op, index) => {
    let affected = 0; let note: string | undefined;
    switch (op.type) {
      case 'WIN': for (const a of select(snapshot, op)) if (a.commitment === 'PIPELINE') { a.commitment = 'CONTRACTED'; a.probability = 1; affected++; } break;
      case 'LOSE': {
        const ids = new Set(select(snapshot, op).filter((a) => a.commitment === 'PIPELINE').map((a) => a.id));
        const contracted = select(snapshot, op).filter((a) => a.commitment !== 'PIPELINE').length;
        if (contracted) note = `${contracted} contracted assignment(s) cannot be lost; use SCOPE or STOP_SERVICE review instead`;
        snapshot.assignments = snapshot.assignments.filter((a) => !ids.has(a.id)); affected = ids.size; break;
      }
      case 'SHIFT': for (const a of select(snapshot, op)) { shift(a, op.days); affected++; } break;
      case 'STRETCH': for (const a of select(snapshot, op)) {
        const start = toDay(a.start); const end = toDay(a.end); const factor = 1 + op.pct / 100;
        const stretch = (iso: string) => fromDay(Math.max(start, start + Math.round((toDay(iso) - start) * factor)));
        a.end = stretch(a.end); for (const d of a.demand) { if (d.start) d.start = stretch(d.start); if (d.end) d.end = stretch(d.end); }
        if (toDay(a.end) < end && factor >= 1) a.end = fromDay(end); affected++;
      } break;
      case 'PRICE': for (const a of hasTarget(op) ? select(snapshot, op) : snapshot.assignments) {
        if (a.commitment !== 'PIPELINE' && !op.includeContracted) continue;
        scaleFees(a, 1 + op.pct / 100); affected++;
      } break;
      case 'EFFORT': for (const a of hasTarget(op) ? select(snapshot, op) : snapshot.assignments) { scaleEffort(a, 1 + op.pct / 100); affected++; } break;
      case 'SCOPE': for (const a of select(snapshot, op)) { scaleFees(a, 1 + op.pct / 100); scaleEffort(a, 1 + op.pct / 100); affected++; } break;
      case 'HIRE': for (let i = 0; i < (op.count ?? 1); i++) {
        snapshot.resources.push({ id: `sim-hire-${index}-${i}`, name: (op.count ?? 1) > 1 ? `${op.name} ${i + 1}` : op.name, kind: 'EMPLOYEE', internal: true, simulated: true,
          weeklyHours: op.weeklyHours, maxAllocationPct: snapshot.config.capacity.defaultMaxAllocationPct, nonProjectPct: snapshot.config.capacity.defaultNonProjectPct,
          activeFrom: op.start, activeTo: null, skills: op.skillIds.map((skillId) => ({ skillId, level: op.level ?? 3 })), absences: [],
          rates: [{ effectiveFrom: op.start, costRate: op.costRate, billRate: null, monthlyFixedCost: op.monthlyFixedCost }], rampUpWeeks: op.rampUpWeeks ?? snapshot.config.hiring.onboardingWeeks });
        affected++;
      } break;
      case 'FREELANCER':
        snapshot.resources.push({ id: `sim-freelancer-${index}`, name: op.name, kind: 'FREELANCER', internal: false, simulated: true, weeklyHours: op.weeklyHours,
          maxAllocationPct: 100, nonProjectPct: 0, activeFrom: op.start, activeTo: op.end ?? null, skills: op.skillIds.map((skillId) => ({ skillId, level: op.level ?? 3 })),
          absences: [], rates: [{ effectiveFrom: op.start, costRate: op.rate, billRate: null, monthlyFixedCost: null }] });
        affected = 1; break;
      case 'REMOVE_RESOURCE': {
        const res = snapshot.resources.find((r) => r.id === op.resourceId);
        if (!res) { note = 'Resource not found'; break; }
        res.activeTo = addDays(op.from, -1);
        for (const a of snapshot.assignments) for (const d of a.demand) if (d.resourceId === res.id && toDay(d.end ?? a.end) >= toDay(op.from)) { d.resourceId = null; affected++; }
        note = 'Named demand from this date is returned to the skill pool';
        break;
      }
      case 'OUTSOURCE': for (const a of hasTarget(op) ? select(snapshot, op) : snapshot.assignments) for (const d of a.demand) {
        if (d.sourcing !== 'INTERNAL' || d.resourceId || (op.skillId && d.skillId !== op.skillId)) continue;
        d.sourcing = 'EXTERNAL'; d.externalRate = op.rate; affected++;
      } break;
      case 'LABOR_COST': {
        const factor = 1 + op.pct / 100; const internal = op.internal ?? true; const external = op.external ?? false;
        for (const r of snapshot.resources) if ((r.internal && internal) || (!r.internal && external)) {
          for (const rate of r.rates) { rate.costRate = scale(rate.costRate, factor) as string; rate.monthlyFixedCost = scale(rate.monthlyFixedCost, factor); }
          affected++;
        }
        for (const a of snapshot.assignments) for (const d of a.demand) {
          if (internal) d.costRate = scale(d.costRate, factor);
          if (external) d.externalRate = scale(d.externalRate, factor);
        }
        const rates = snapshot.config.rates;
        if (internal) rates.defaultInternalCostRate = scale(rates.defaultInternalCostRate, factor) as string;
        if (external) { rates.defaultExternalRate = scale(rates.defaultExternalRate, factor) as string; rates.shortageCostRate = scale(rates.shortageCostRate, factor) as string; }
        break;
      }
      case 'OVERHEAD': for (const line of snapshot.config.overhead.monthly) { line.amount = scale(line.amount, 1 + op.pct / 100) as string; affected++; } break;
      case 'PAYMENT_TERMS': for (const a of hasTarget(op) ? select(snapshot, op) : snapshot.assignments) { a.paymentTermDays = op.days; affected++; } break;
      case 'PAYMENT_DELAY':
        for (const a of hasTarget(op) ? select(snapshot, op) : snapshot.assignments) { a.collectionDelayDays = (a.collectionDelayDays ?? 0) + op.days; affected++; }
        for (const ar of snapshot.openReceivables) if (!op.clientId || ar.clientId === op.clientId) if (!op.assignmentIds?.length) { ar.dueDate = addDays(ar.dueDate, op.days); affected++; }
        break;
      case 'STOP_SERVICE': {
        const from = op.from ? toDay(op.from) : -Infinity;
        const stop = new Set(snapshot.assignments.filter((a) => a.serviceId === op.serviceId && a.commitment === 'PIPELINE' && toDay(a.start) >= from).map((a) => a.id));
        const committed = snapshot.assignments.filter((a) => a.serviceId === op.serviceId && a.commitment === 'CONTRACTED').length;
        if (committed) note = `${committed} contracted assignment(s) remain (contractual obligation)`;
        snapshot.assignments = snapshot.assignments.filter((a) => !stop.has(a.id)); affected = stop.size; break;
      }
      case 'PROBABILITY': for (const a of select(snapshot, op)) if (a.commitment === 'PIPELINE') { a.probability = Math.min(1, Math.max(0, op.probabilityPct / 100)); affected++; } break;
      case 'OPENING_CASH': snapshot.openingCash = money(dec(op.amount)); snapshot.openingCashSource = 'MANUAL'; affected = 1; break;
      case 'NEW_SERVICE': snapshot.assignments.push({ ...structuredClone(op.assignment), id: op.assignment.id ?? `sim-assignment-${index}` }); affected = 1; break;
      default: throw new Error(`Unknown scenario operation ${(op as { type: string }).type}`);
    }
    log.push({ index, type: op.type, affected, ...(note ? { note } : {}) });
  });
  return { snapshot, log };
}

export function scenarioMetrics(result: PortfolioResult): ScenarioMetrics {
  return {
    revenue: result.totals.revenue, contribution: result.totals.contribution, marginPct: result.totals.marginPct, operatingResult: result.totals.operatingResult,
    endCash: result.cash.endBalance, minCash: result.cash.minBalance, peakDeficit: result.cash.peakDeficit, financingRequirement: result.cash.financingRequirement,
    utilization: result.totals.utilization, shortageHours: result.totals.shortageHours,
    overloadCount: result.capacity.bottlenecks.filter((b) => b.kind === 'RESOURCE_OVERLOAD').length,
    fixedCostCommitment: money(sum([dec(result.totals.capacityCost), dec(result.totals.overhead)])),
    topClientSharePct: result.totals.topClientSharePct, unabsorbedCapacity: result.totals.unabsorbedCapacity,
  };
}

export function runScenario(snapshot: EngineSnapshot, operations: ScenarioOperation[], mode: PortfolioMode, calculatedAt?: string) {
  const applied = applyOperations(snapshot, operations);
  const result = computePortfolio(applied.snapshot, mode, { calculatedAt });
  return { result, metrics: scenarioMetrics(result), log: applied.log };
}

const MONEY_KEYS = new Set<keyof ScenarioMetrics>(['revenue', 'contribution', 'operatingResult', 'endCash', 'minCash', 'peakDeficit', 'financingRequirement', 'fixedCostCommitment', 'unabsorbedCapacity']);
export function compareMetrics(baseline: ScenarioMetrics, scenarios: ScenarioMetrics[]): ScenarioComparisonRow[] {
  return (Object.keys(baseline) as (keyof ScenarioMetrics)[]).map((key) => ({
    key, baseline: baseline[key], values: scenarios.map((s) => s[key]),
    deltas: scenarios.map((s) => {
      const b = baseline[key]; const v = s[key];
      if (b === null || v === null) return null;
      if (MONEY_KEYS.has(key)) return money(dec(v as string).minus(dec(b as string)));
      return Math.round(((v as number) - (b as number)) * 10000) / 10000;
    }),
  }));
}

function sensitivityOperation(parameter: SensitivityParameter, step: number, includeContracted: boolean, snapshot: EngineSnapshot): ScenarioOperation[] {
  switch (parameter) {
    case 'PRICE': return [{ type: 'PRICE', pct: step, includeContracted }];
    case 'HOURS': return [{ type: 'EFFORT', pct: step }];
    case 'INTERNAL_RATE': return [{ type: 'LABOR_COST', pct: step, internal: true, external: false }];
    case 'EXTERNAL_RATE': return [{ type: 'LABOR_COST', pct: step, internal: false, external: true }];
    case 'DURATION': return [{ type: 'STRETCH', pct: step, assignmentIds: snapshot.assignments.map((a) => a.id) }];
    case 'PAYMENT_DELAY': return [{ type: 'PAYMENT_DELAY', days: Math.round(step) }];
    case 'PROBABILITY': return snapshot.assignments.filter((a) => a.commitment === 'PIPELINE')
      .map((a) => ({ type: 'PROBABILITY' as const, assignmentIds: [a.id], probabilityPct: Math.min(100, Math.max(0, a.probability * 100 * (1 + step / 100))) }));
  }
}

/**
 * Controlled one-parameter variation. Steps are percentages, except PAYMENT_DELAY (days).
 * Break-even points are searched by bisection and only reported when the metric changes sign
 * inside the searched range (monotonic response assumed and disclosed).
 */
export function sensitivity(snapshot: EngineSnapshot, mode: PortfolioMode, parameter: SensitivityParameter, steps: number[], includeContracted = false): SensitivityResult {
  const evaluate = (step: number) => scenarioMetrics(computePortfolio(applyOperations(snapshot, sensitivityOperation(parameter, step, includeContracted, snapshot)).snapshot, mode, { calculatedAt: 'sensitivity' }));
  const rows = steps.map((pct) => ({ pct, metrics: evaluate(pct) }));
  const [lo, hi] = parameter === 'PAYMENT_DELAY' ? [0, 365] : parameter === 'PROBABILITY' ? [-100, 100] : [-95, 500];
  const breakEven = (['operatingResult', 'contribution', 'minCash'] as const).map((metric) => {
    const value = (step: number) => Number(evaluate(step)[metric]);
    let a = lo, b = hi; let fa = value(a); const fb = value(b);
    if (fa === 0) return { metric, pct: a, note: 'Break-even at range limit' };
    if (Math.sign(fa) === Math.sign(fb)) return { metric, pct: null, note: `No sign change between ${lo} and ${hi}${parameter === 'PAYMENT_DELAY' ? ' days' : '%'}` };
    for (let i = 0; i < 24; i++) {
      const mid = (a + b) / 2; const fm = value(mid);
      if (Math.sign(fm) === Math.sign(fa)) { a = mid; fa = fm; } else b = mid;
    }
    return { metric, pct: Math.round(((a + b) / 2) * 100) / 100, note: 'Bisection; assumes a monotonic response' };
  });
  return { parameter, steps: rows, breakEven };
}
