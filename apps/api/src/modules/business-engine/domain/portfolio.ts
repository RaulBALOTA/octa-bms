import type {
  Aggregate, AssignmentEconomics, Bottleneck, CashPeriod, DataBasis, EngineSnapshot, PnlPeriod, PortfolioMode, PortfolioResult,
  ResourceCapacity, Seniority, SkillCapacity, SnapshotAssignment, SnapshotDemand, SnapshotResource,
} from '../../../../../../packages/shared/src/business-engine';
import { D, Dec, ZERO, allocate, dec, money, pct, ratio, round, sum } from './money';
import {
  EngineInputError, WorkCalendar, addMonths, buildTimeline, fromDay, monthEnd, monthStart, nextMonthStart, rangeFractions, toDay,
} from './calendar';
import { ENGINE_VERSION } from './config';

export const SENIORITY_LEVEL: Record<Seniority, number> = { JUNIOR: 1, PROFESSIONAL: 2, SENIOR: 3, LEAD: 4, PRINCIPAL: 5 };
const EPS = 1e-6;
const MAX_SPAN_DAYS = 15 * 366;

/* ------------------------------------------------------------------ internal structures */

interface Rates { from: number[]; cost: Dec[]; bill: (Dec | null)[]; fixed: (Dec | null)[] }
interface ResourceState {
  r: SnapshotResource; index: number; rates: Rates; from: number; to: number;
  weekNominal: number[]; weekAbsence: number[]; weekNonProject: number[]; weekAvailable: number[]; weekPlanned: number[]; weekBillable: number[];
}
interface LineState {
  a: SnapshotAssignment; d: SnapshotDemand; ai: number; weight: number; key: string;
  hoursAtCompletion: number; remaining: number; rangeStart: number; rangeEnd: number;
  segHours: Float64Array; beyondHours: number; resource: ResourceState | null; pooled: boolean; minLevel: number;
  /** per week: resourceIndex → share of the line's week hours; shortage share; external share */
  weekShares: Map<number, { alloc: [number, number][]; shortage: number }>;
}
interface AssignmentState {
  a: SnapshotAssignment; weight: number; lines: LineState[]; revenue: Dec; plannedRevenue: Dec; warnings: string[];
  monthRevenue: Dec[]; monthInternal: Dec[]; monthExternal: Dec[]; monthShortage: Dec[]; monthExpenses: Dec[];
  beyondRevenue: Dec; beyondInternal: Dec; beyondExternal: Dec; beyondExpenses: Dec;
  internalHours: number; externalHours: number; shortageHours: number; remainingHours: number; remainingExpenses: Dec; totalExpenses: Dec;
  plannedHours: number; hoursAtCompletion: number; plannedCost: Dec; invoices: { day: number; net: Dec }[];
}
interface RawEvent { day: number; amount: Dec; category: string; source: DataBasis; assignmentId?: string; label: string }

function rateIndex(rates: Rates, day: number): number {
  let index = -1;
  for (let i = 0; i < rates.from.length; i++) if (rates.from[i] <= day) index = i;
  return index;
}

/* ------------------------------------------------------------------ main entry */

export interface PortfolioOptions {
  calculatedAt?: string;
  /** Skip pooled capacity allocation: unnamed internal demand is costed at standard rates (used to build optimizer coefficients). */
  standardCosting?: boolean;
  /** Omit payroll, overhead and open AR/AP (isolated cash effect of the assignments). */
  excludeCompanyCosts?: boolean;
}

export function computePortfolio(snapshot: EngineSnapshot, mode: PortfolioMode, options: PortfolioOptions = {}): PortfolioResult {
  const config = snapshot.config;
  const warnings: PortfolioResult['warnings'] = [];
  const warn = (code: string, message: string, entityId?: string) => { if (warnings.length < 500) warnings.push({ code, message, ...(entityId ? { entityId } : {}) }); };
  const asOf = toDay(snapshot.asOf);
  const horizonEnd = toDay(snapshot.horizonEnd);
  if (horizonEnd <= asOf) throw new EngineInputError('INVALID_HORIZON', 'Horizon end must be after the as-of date');

  // Calendar span covers every referenced date plus collection lag.
  let spanStart = asOf - 7; let spanEnd = horizonEnd + 400;
  for (const a of snapshot.assignments) {
    spanStart = Math.min(spanStart, toDay(a.start)); spanEnd = Math.max(spanEnd, toDay(a.end));
    if (toDay(a.end) < toDay(a.start)) throw new EngineInputError('INVALID_RANGE', `Assignment "${a.title}" ends before it starts`);
    for (const d of a.demand) {
      if (d.start) spanStart = Math.min(spanStart, toDay(d.start));
      if (d.end) spanEnd = Math.max(spanEnd, toDay(d.end));
    }
  }
  if (spanEnd - spanStart > MAX_SPAN_DAYS) throw new EngineInputError('SPAN_TOO_LARGE', 'Dates span more than 15 years');
  const cal = new WorkCalendar(spanStart, spanEnd, config.calendar.holidayRegion, config.calendar.extraHolidays);
  const tl = buildTimeline(asOf, horizonEnd);
  const W = tl.weeks.length; const M = tl.months.length; const S = tl.segments.length;
  const segBuckets = tl.segments.map((s) => ({ start: s.start, end: s.end }));
  const shortageRate = dec(config.rates.shortageCostRate);

  /* ------------------------------------------------ resources: capacity per week */
  const resources: ResourceState[] = snapshot.resources.map((r, index) => {
    const sorted = [...r.rates].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom));
    const rates: Rates = { from: sorted.map((x) => toDay(x.effectiveFrom)), cost: sorted.map((x) => dec(x.costRate)),
      bill: sorted.map((x) => (x.billRate === null ? null : dec(x.billRate))), fixed: sorted.map((x) => (x.monthlyFixedCost === null ? null : dec(x.monthlyFixedCost))) };
    if (!sorted.length) warn('MISSING_RATE', `Resource "${r.name}" has no cost rate; default rates are used`, r.id);
    const from = r.activeFrom ? toDay(r.activeFrom) : -Infinity; const to = r.activeTo ? toDay(r.activeTo) : Infinity;
    const absence = new Map<number, number>();
    for (const ab of r.absences) for (let d = toDay(ab.start); d <= toDay(ab.end); d++) absence.set(d, Math.min(1, (absence.get(d) ?? 0) + ab.fraction));
    const perDay = r.weeklyHours / 5;
    const state: ResourceState = { r, index, rates, from, to, weekNominal: new Array(W).fill(0), weekAbsence: new Array(W).fill(0), weekNonProject: new Array(W).fill(0),
      weekAvailable: new Array(W).fill(0), weekPlanned: new Array(W).fill(0), weekBillable: new Array(W).fill(0) };
    tl.weekRanges.forEach(([ws, we], w) => {
      let nominal = 0, abs = 0, nonProject = 0, available = 0;
      for (let d = Math.max(ws, from); d <= Math.min(we, to); d++) {
        if (!cal.isWorkday(d)) continue;
        const absent = perDay * (absence.get(d) ?? 0);
        const present = perDay - absent;
        const np = present * r.nonProjectPct / 100;
        const ramp = r.rampUpWeeks && Number.isFinite(from) ? Math.min(1, 0.25 + 0.75 * (d - from) / (r.rampUpWeeks * 7)) : 1;
        nominal += perDay; abs += absent; nonProject += np;
        available += Math.min((present - np) * ramp, perDay * r.maxAllocationPct / 100);
      }
      state.weekNominal[w] = nominal; state.weekAbsence[w] = abs; state.weekNonProject[w] = nonProject; state.weekAvailable[w] = Math.max(0, available);
    });
    return state;
  });
  const resourceById = new Map(resources.map((r) => [r.r.id, r]));
  const costAt = (res: ResourceState | null, day: number, fallback: Dec): Dec => {
    if (!res) return fallback;
    const i = rateIndex(res.rates, day);
    if (i >= 0) return res.rates.cost[i];
    return res.rates.cost.length ? res.rates.cost[0] : fallback;
  };

  /* ------------------------------------------------ skills: qualification with hierarchy */
  const children = new Map<string, string[]>();
  for (const s of snapshot.skills) if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s.id]);
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>([id]); const stack = [id];
    while (stack.length) { const cur = stack.pop() as string; for (const c of children.get(cur) ?? []) if (!out.has(c)) { out.add(c); stack.push(c); } }
    return out;
  };
  const qualifiedCache = new Map<string, ResourceState[]>();
  const qualified = (skillId: string | null, level: number): ResourceState[] => {
    const key = `${skillId ?? '*'}:${level}`;
    let list = qualifiedCache.get(key);
    if (!list) {
      const allowed = skillId ? descendants(skillId) : null;
      list = resources.filter((res) => !allowed || res.r.skills.some((s) => allowed.has(s.skillId) && s.level >= level))
        .sort((x, y) => Number(y.r.internal) - Number(x.r.internal) || costAt(x, asOf, ZERO).comparedTo(costAt(y, asOf, ZERO)) || x.r.id.localeCompare(y.r.id));
      qualifiedCache.set(key, list);
    }
    return list;
  };
  const skillName = new Map(snapshot.skills.map((s) => [s.id, s.name]));

  /* ------------------------------------------------ assignments and demand lines */
  const weightOf = (a: SnapshotAssignment) => a.commitment === 'PIPELINE' ? (mode === 'CONTRACTED' ? 0 : mode === 'ALL_WIN' ? 1 : a.probability) : 1;
  const assignments: AssignmentState[] = snapshot.assignments.map((a, ai) => {
    const weight = weightOf(a);
    const aStart = toDay(a.start), aEnd = toDay(a.end);
    const aw: string[] = [];
    const lines: LineState[] = a.demand.map((d, li) => {
      const start = d.start ? toDay(d.start) : aStart; const end = d.end ? toDay(d.end) : aEnd;
      if (end < start) throw new EngineInputError('INVALID_RANGE', `Demand "${d.role}" in "${a.title}" ends before it starts`);
      const remaining = Math.max(0, d.remainingHours ?? d.hours - d.actualHours);
      const hoursAtCompletion = d.actualHours + remaining;
      let rangeStart = Math.max(start, asOf); let rangeEnd = end;
      if (remaining > EPS && end < asOf) { rangeStart = asOf; rangeEnd = asOf + 27; aw.push(`OVERDUE_WORK:${d.role}`); }
      const fractions = rangeFractions(cal, rangeStart, rangeEnd, segBuckets);
      const segHours = Float64Array.from(fractions.map((f) => remaining * f));
      const inHorizon = segHours.reduce((x, y) => x + y, 0);
      let resource = d.resourceId ? resourceById.get(d.resourceId) ?? null : null;
      if (d.resourceId && !resource) aw.push(`RESOURCE_UNAVAILABLE:${d.role}`);
      if (resource && d.sourcing === 'EXTERNAL' && resource.r.internal) resource = null;
      return { a, d, ai, weight, key: `${a.id}:${li}`, hoursAtCompletion, remaining, rangeStart, rangeEnd, segHours, beyondHours: Math.max(0, remaining - inHorizon),
        resource, pooled: !resource && d.sourcing === 'INTERNAL', minLevel: SENIORITY_LEVEL[d.seniority] ?? 1, weekShares: new Map() };
    });
    const zeros = () => new Array<Dec>(M).fill(ZERO);
    return { a, weight, lines, revenue: ZERO, plannedRevenue: ZERO, warnings: aw, monthRevenue: zeros(), monthInternal: zeros(), monthExternal: zeros(), monthShortage: zeros(),
      monthExpenses: zeros(), beyondRevenue: ZERO, beyondInternal: ZERO, beyondExternal: ZERO, beyondExpenses: ZERO, internalHours: 0, externalHours: 0, shortageHours: 0,
      remainingHours: 0, remainingExpenses: ZERO, totalExpenses: ZERO, plannedHours: 0, hoursAtCompletion: 0, plannedCost: ZERO, invoices: [] };
  });
  const allLines = assignments.flatMap((s) => s.lines);

  /* ------------------------------------------------ capacity allocation (weekly, weighted hours) */
  const lineWeek: Map<string, Float64Array> = new Map();
  for (const line of allLines) {
    const arr = new Float64Array(W);
    for (let s = 0; s < S; s++) arr[tl.segments[s].week] += line.segHours[s];
    lineWeek.set(line.key, arr);
  }
  const skillWeeks = new Map<string, { demand: number[]; covered: number[] }>();
  const skillKey = (id: string | null) => id ?? '*';
  for (let w = 0; w < W; w++) {
    for (const line of allLines) {
      if (!line.resource || line.weight <= 0) continue;
      const h = (lineWeek.get(line.key) as Float64Array)[w] * line.weight;
      if (h <= EPS) continue;
      line.resource.weekPlanned[w] += h;
      if (line.d.billable) line.resource.weekBillable[w] += h;
      line.weekShares.set(w, { alloc: [[line.resource.index, 1]], shortage: 0 });
    }
    if (options.standardCosting) {
      for (const line of allLines) {
        if (!line.pooled || line.weight <= 0) continue;
        const need = (lineWeek.get(line.key) as Float64Array)[w] * line.weight;
        if (need <= EPS) continue;
        const sk = skillWeeks.get(skillKey(line.d.skillId)) ?? { demand: new Array(W).fill(0), covered: new Array(W).fill(0) };
        sk.demand[w] += need; sk.covered[w] += need; skillWeeks.set(skillKey(line.d.skillId), sk);
      }
      continue;
    }
    const free = resources.map((res) => Math.max(0, res.weekAvailable[w] - res.weekPlanned[w]));
    const pool = allLines.filter((line) => line.pooled && line.weight > 0 && (lineWeek.get(line.key) as Float64Array)[w] > EPS)
      .map((line) => ({ line, q: qualified(line.d.skillId, line.minLevel) }))
      .sort((x, y) => Number(x.line.a.commitment === 'PIPELINE') - Number(y.line.a.commitment === 'PIPELINE') || x.q.length - y.q.length || x.line.key.localeCompare(y.line.key));
    for (const { line, q } of pool) {
      const need = (lineWeek.get(line.key) as Float64Array)[w] * line.weight;
      let left = need; const alloc: [number, number][] = [];
      for (const res of q) {
        if (left <= EPS) break;
        const take = Math.min(free[res.index], left);
        if (take <= EPS) continue;
        free[res.index] -= take; left -= take; res.weekPlanned[w] += take;
        if (line.d.billable) res.weekBillable[w] += take;
        alloc.push([res.index, take / need]);
      }
      const shortage = Math.max(0, left) / need;
      line.weekShares.set(w, { alloc, shortage });
      const sk = skillWeeks.get(skillKey(line.d.skillId)) ?? { demand: new Array(W).fill(0), covered: new Array(W).fill(0) };
      sk.demand[w] += need; sk.covered[w] += need - Math.max(0, left); skillWeeks.set(skillKey(line.d.skillId), sk);
    }
  }

  /* ------------------------------------------------ economics per line and assignment */
  const defaultInternal = (d: SnapshotDemand) => d.costRate ? dec(d.costRate) : dec(config.rates.defaultInternalCostRate).times(config.rates.seniorityCostFactors[d.seniority] ?? 1);
  const defaultExternal = (d: SnapshotDemand) => dec(d.externalRate ?? config.rates.defaultExternalRate);
  const standardRate = (line: LineState, day: number) => line.resource ? costAt(line.resource, day, defaultInternal(line.d))
    : line.d.sourcing === 'EXTERNAL' ? defaultExternal(line.d) : defaultInternal(line.d);

  for (const st of assignments) {
    const a = st.a;
    const aStart = toDay(a.start), aEnd = toDay(a.end);
    let billableAtCompletion = 0; let billablePlanned = 0;
    for (const line of st.lines) {
      st.plannedHours += line.d.hours; st.hoursAtCompletion += line.hoursAtCompletion; st.remainingHours += line.remaining;
      if (line.d.billable) { billableAtCompletion += line.hoursAtCompletion; billablePlanned += line.d.hours; }
      st.plannedCost = st.plannedCost.plus(standardRate(line, line.d.start ? toDay(line.d.start) : aStart).times(line.d.hours));
      // in-horizon cost by month, grouped by (month, resource rate) to keep decimal operations bounded
      const groups = new Map<string, { m: number; hours: number; rate: Dec; kind: 'INTERNAL' | 'EXTERNAL' | 'SHORTAGE' }>();
      const add = (m: number, hours: number, rate: Dec, kind: 'INTERNAL' | 'EXTERNAL' | 'SHORTAGE', id: string) => {
        if (hours <= EPS) return;
        const key = `${m}|${kind}|${id}|${rate.toString()}`;
        const g = groups.get(key) ?? { m, hours: 0, rate, kind }; g.hours += hours; groups.set(key, g);
      };
      for (let s = 0; s < S; s++) {
        const h = line.segHours[s]; if (h <= EPS) continue;
        const seg = tl.segments[s];
        if (!line.resource && line.d.sourcing === 'EXTERNAL') { add(seg.month, h, defaultExternal(line.d), 'EXTERNAL', 'ext'); continue; }
        const shares = line.weekShares.get(seg.week);
        if (!shares) { // weight 0 (excluded by mode): standard costing, no capacity effect
          add(seg.month, h, standardRate(line, seg.start), line.resource && !line.resource.r.internal ? 'EXTERNAL' : 'INTERNAL', 'std'); continue;
        }
        for (const [ri, share] of shares.alloc) {
          const res = resources[ri];
          add(seg.month, h * share, costAt(res, seg.start, defaultInternal(line.d)), res.r.internal ? 'INTERNAL' : 'EXTERNAL', res.r.id);
        }
        add(seg.month, h * shares.shortage, shortageRate, 'SHORTAGE', 'short');
      }
      for (const g of groups.values()) {
        const amount = g.rate.times(new D(g.hours.toFixed(6)));
        if (g.kind === 'INTERNAL') { st.monthInternal[g.m] = st.monthInternal[g.m].plus(amount); st.internalHours += g.hours; }
        else if (g.kind === 'EXTERNAL') { st.monthExternal[g.m] = st.monthExternal[g.m].plus(amount); st.externalHours += g.hours; }
        else { st.monthShortage[g.m] = st.monthShortage[g.m].plus(amount); st.shortageHours += g.hours; }
      }
      if (line.beyondHours > EPS) {
        const amount = standardRate(line, horizonEnd).times(new D(line.beyondHours.toFixed(6)));
        if (line.d.sourcing === 'EXTERNAL' || (line.resource && !line.resource.r.internal)) { st.beyondExternal = st.beyondExternal.plus(amount); st.externalHours += line.beyondHours; }
        else { st.beyondInternal = st.beyondInternal.plus(amount); st.internalHours += line.beyondHours; }
      }
    }
    if (st.lines.some((l) => l.beyondHours > EPS)) st.warnings.push('BEYOND_HORIZON');

    // revenue
    const revenueFor = (billable: number): Dec => {
      const need = (value: unknown, field: string) => { if (value === null || value === undefined) st.warnings.push(`MISSING_FEE_PARAMETER:${field}`); };
      let r: Dec;
      switch (a.feeModel) {
        case 'FIXED_FEE': need(a.fixedFee, 'fixedFee'); r = dec(a.fixedFee); break;
        case 'TIME_AND_MATERIALS': need(a.hourlyRate, 'hourlyRate'); r = dec(a.hourlyRate).times(new D(billable.toFixed(6))); break;
        case 'DAILY_RATE': need(a.dailyRate, 'dailyRate'); r = dec(a.dailyRate).times(new D(billable.toFixed(6))).div(a.hoursPerDay ?? config.calendar.hoursPerDay); break;
        case 'RETAINER': {
          need(a.monthlyRetainer, 'monthlyRetainer');
          let months = new D(0);
          for (let m = monthStart(aStart); m <= aEnd; m = nextMonthStart(m)) {
            const days = Math.min(aEnd, monthEnd(m)) - Math.max(aStart, m) + 1;
            months = months.plus(new D(days).div(monthEnd(m) - m + 1));
          }
          r = dec(a.monthlyRetainer).times(months); break;
        }
        case 'MILESTONE': if (!a.milestones.length) st.warnings.push('MISSING_FEE_PARAMETER:milestones'); r = sum(a.milestones.map((x) => dec(x.amount))); break;
        case 'CAPEX_PERCENT': need(a.capexBasis, 'capexBasis'); need(a.capexPercent, 'capexPercent'); r = dec(a.capexBasis).times(dec(a.capexPercent)).div(100); break;
        case 'HYBRID': r = dec(a.fixedFee).plus(dec(a.hourlyRate).times(new D(billable.toFixed(6)))); break;
        default: throw new EngineInputError('INVALID_FEE_MODEL', `Unknown fee model ${String(a.feeModel)}`);
      }
      return r.plus(sum(a.adjustments.map((x) => dec(x.amount))));
    };
    st.revenue = revenueFor(billableAtCompletion);
    st.plannedRevenue = revenueFor(billablePlanned);
    st.warnings = [...new Set(st.warnings)];

    // phasing of remaining revenue and expenses: by remaining-hours profile, retainer by calendar days
    const actualRevenue = dec(a.actuals.revenue);
    let remainingRevenue = st.revenue.minus(actualRevenue);
    if (remainingRevenue.isNegative()) { st.warnings.push('REVENUE_EXCEEDS_FORECAST'); remainingRevenue = ZERO; }
    const monthHours = new Array<number>(M).fill(0); let beyond = 0;
    for (const line of st.lines) { for (let s = 0; s < S; s++) monthHours[tl.segments[s].month] += line.segHours[s]; beyond += line.beyondHours; }
    const remainingStart = Math.max(aStart, asOf); const remainingEnd = Math.max(aEnd, remainingStart);
    const timeWeights = (): number[] => {
      if (aEnd < asOf) return [1, ...new Array(M).fill(0)].slice(0, M).concat([0]);
      const f = rangeFractions(cal, remainingStart, remainingEnd, tl.monthRanges.map(([s, e]) => ({ start: s, end: e })));
      return [...f, Math.max(0, 1 - f.reduce((x, y) => x + y, 0))];
    };
    const hoursTotal = monthHours.reduce((x, y) => x + y, 0) + beyond;
    const profile = a.feeModel !== 'RETAINER' && hoursTotal > EPS ? [...monthHours, beyond] : timeWeights();
    const revParts = allocate(remainingRevenue, profile);
    st.monthRevenue = revParts.slice(0, M); st.beyondRevenue = revParts[M];
    st.totalExpenses = sum([a.expenses.travel, a.expenses.software, a.expenses.other, a.expenses.subcontractFixed].map(dec));
    const remainingShare = a.actuals.percentComplete !== null ? Math.max(0, 1 - a.actuals.percentComplete / 100)
      : st.hoursAtCompletion > EPS ? st.remainingHours / st.hoursAtCompletion
      : aEnd <= aStart ? (aEnd < asOf ? 0 : 1) : Math.min(1, Math.max(0, (aEnd - Math.max(aStart, asOf) + 1) / (aEnd - aStart + 1)));
    st.remainingExpenses = st.totalExpenses.times(new D(remainingShare.toFixed(8)));
    const expParts = allocate(st.remainingExpenses, hoursTotal > EPS ? [...monthHours, beyond] : timeWeights());
    st.monthExpenses = expParts.slice(0, M); st.beyondExpenses = expParts[M];

    // invoicing schedule (net) of the remaining amount to invoice
    const invoicedNet = dec(a.actuals.invoicedNet);
    let toInvoice = st.revenue.minus(invoicedNet);
    if (toInvoice.isNegative()) { st.warnings.push('OVER_INVOICED'); toInvoice = ZERO; }
    const clampDay = (day: number) => Math.max(day, asOf);
    if (a.billing === 'MONTHLY') {
      const amounts = [...st.monthRevenue];
      let delta = toInvoice.minus(remainingRevenue); // WIP catch-up (+) or advance invoicing (−)
      for (let m = 0; m < M && !delta.isZero(); m++) {
        if (delta.isPositive()) { amounts[m] = amounts[m].plus(delta); delta = ZERO; }
        else { const cut = D.min(amounts[m], delta.abs()); amounts[m] = amounts[m].minus(cut); delta = delta.plus(cut); }
      }
      amounts.forEach((amount, m) => { if (!amount.isZero()) st.invoices.push({ day: tl.monthRanges[m][1], net: amount }); });
    } else if (a.billing === 'MILESTONE') {
      const open = a.milestones.filter((x) => !x.invoiced).map((x) => ({ day: clampDay(toDay(x.date)), net: dec(x.amount) })).sort((x, y) => x.day - y.day);
      let diff = toInvoice.minus(sum(open.map((x) => x.net)));
      for (let i = open.length - 1; i >= 0 && diff.isNegative(); i--) { const cut = D.min(open[i].net, diff.abs()); open[i].net = open[i].net.minus(cut); diff = diff.plus(cut); }
      if (diff.isPositive()) { st.invoices.push({ day: clampDay(aEnd), net: diff }); st.warnings.push('UNSCHEDULED_BALANCE'); }
      st.invoices.push(...open.filter((x) => !x.net.isZero()));
    } else if (a.billing === 'UPFRONT') { if (!toInvoice.isZero()) st.invoices.push({ day: clampDay(aStart), net: toInvoice }); }
    else if (!toInvoice.isZero()) st.invoices.push({ day: clampDay(aEnd), net: toInvoice });
  }

  /* ------------------------------------------------ overhead allocation (costing convention) */
  const allocMethod = config.overhead.allocation.method; const allocValue = dec(config.overhead.allocation.value);
  const allocatedOverhead = (revenue: Dec, direct: Dec, internalHours: number) =>
    allocMethod === 'PERCENT_OF_REVENUE' ? revenue.times(allocValue).div(100)
      : allocMethod === 'PERCENT_OF_DIRECT_COST' ? direct.times(allocValue).div(100)
      : allocMethod === 'RATE_PER_INTERNAL_HOUR' ? allocValue.times(new D(internalHours.toFixed(6))) : ZERO;

  /* ------------------------------------------------ cash events */
  const vatOn = config.vat.enabled;
  const events: RawEvent[] = [];
  const vatByMonth = new Map<number, Dec>();
  const addVat = (day: number, amount: Dec) => { if (!vatOn || amount.isZero()) return; const m = monthStart(day); vatByMonth.set(m, (vatByMonth.get(m) ?? ZERO).plus(amount)); };
  const inCash = (day: number) => day >= asOf && day <= horizonEnd;
  const supplierTerm = config.cash.supplierPaymentTermDays;

  const economics: AssignmentEconomics[] = assignments.map((st) => {
    const a = st.a; const w = new D(st.weight);
    const internal = sum(st.monthInternal).plus(st.beyondInternal);
    const external = sum(st.monthExternal).plus(st.beyondExternal);
    const shortage = sum(st.monthShortage);
    const costToComplete = internal.plus(external).plus(shortage).plus(st.remainingExpenses);
    const actualCost = dec(a.actuals.cost);
    const costAtCompletion = actualCost.plus(costToComplete);
    const contribution = st.revenue.minus(costAtCompletion);
    const marginPct = ratio(contribution, st.revenue);
    const overhead = allocatedOverhead(st.revenue, costAtCompletion, st.internalHours + a.actuals.hours);
    const vatRate = pct(a.vatRatePct);
    // assignment-level cash (net of VAT): receipts − external payments − internal labor at month end
    const own: { day: number; amount: Dec }[] = [];
    const term = a.paymentTermDays + config.cash.collectionDelayDays + (a.collectionDelayDays ?? 0);
    for (const inv of st.invoices) {
      const receipt = inv.day + term;
      own.push({ day: receipt, amount: inv.net });
      if (st.weight > 0) {
        if (inCash(inv.day)) addVat(inv.day, inv.net.times(vatRate).times(w));
        if (inCash(receipt)) events.push({ day: receipt, amount: inv.net.times(vatOn ? vatRate.plus(1) : 1).times(w), category: 'RECEIPT', source: a.commitment === 'PIPELINE' ? 'WEIGHTED' : 'CONTRACTED', assignmentId: a.id, label: a.title });
      }
    }
    for (let m = 0; m < M; m++) {
      const out = st.monthExternal[m].plus(st.monthShortage[m]).plus(st.monthExpenses[m]);
      const invoiceDay = tl.monthRanges[m][1]; const payDay = invoiceDay + supplierTerm;
      if (!out.isZero()) {
        own.push({ day: payDay, amount: out.neg() });
        if (st.weight > 0) {
          addVat(invoiceDay, out.times(pct(config.vat.ratePct)).times(w).neg());
          if (inCash(payDay)) events.push({ day: payDay, amount: out.times(vatOn ? pct(config.vat.ratePct).plus(1) : 1).times(w).neg(), category: 'EXTERNAL_COST', source: a.commitment === 'PIPELINE' ? 'WEIGHTED' : 'FORECAST', assignmentId: a.id, label: a.title });
        }
      }
      if (!st.monthInternal[m].isZero()) own.push({ day: invoiceDay, amount: st.monthInternal[m].neg() });
    }
    own.sort((x, y) => x.day - y.day);
    let cum = ZERO, minCum = ZERO, lastNegative: number | null = null; let billedGross = ZERO, received = ZERO, exposure = ZERO;
    for (const e of own) {
      if (e.day > horizonEnd) break;
      cum = cum.plus(e.amount); if (cum.lt(minCum)) minCum = cum; if (cum.isNegative()) lastNegative = e.day;
    }
    for (const inv of [...st.invoices].sort((x, y) => x.day - y.day)) {
      billedGross = billedGross.plus(inv.net);
      received = sum(st.invoices.filter((x) => x.day + term <= inv.day).map((x) => x.net));
      exposure = D.max(exposure, billedGross.minus(received));
    }
    const positiveFrom = cum.isNegative() ? null : lastNegative === null ? (own.length ? own[0].day : null) : (own.find((e) => e.day > (lastNegative as number))?.day ?? null);
    const eco: AssignmentEconomics = {
      id: a.id, title: a.title, serviceId: a.serviceId, serviceName: a.serviceName, clientId: a.clientId, clientName: a.clientName, packageId: a.packageId,
      contractId: a.contractId, opportunityId: a.opportunityId, commitment: a.commitment, probability: a.probability, weight: st.weight,
      start: a.start, end: a.end, feeModel: a.feeModel,
      plannedRevenue: money(st.plannedRevenue), revenue: money(st.revenue), internalCost: money(internal), externalCost: money(external), shortageCost: money(shortage),
      expenses: money(st.totalExpenses), directCost: money(costAtCompletion), contribution: money(contribution), marginPct: marginPct === null ? null : round(marginPct * 100, 2),
      allocatedOverhead: money(overhead), operatingResult: money(contribution.minus(overhead)),
      plannedHours: round(st.plannedHours), hoursAtCompletion: round(st.hoursAtCompletion), actualHours: round(a.actuals.hours), remainingHours: round(st.remainingHours),
      internalHours: round(st.internalHours), externalHours: round(st.externalHours), shortageHours: round(st.shortageHours),
      actualCost: money(actualCost), costToComplete: money(costToComplete), costAtCompletion: money(costAtCompletion), plannedCost: money(st.plannedCost.plus(st.totalExpenses)),
      remainingRevenue: money(D.max(ZERO, st.revenue.minus(dec(a.actuals.revenue)))), invoicedNet: money(dec(a.actuals.invoicedNet)),
      baselineMarginPct: a.baseline?.marginPct ?? null,
      hoursVariance: round(st.hoursAtCompletion - (a.baseline?.hours ?? st.plannedHours)),
      marginVariancePts: a.baseline?.marginPct !== null && a.baseline?.marginPct !== undefined && marginPct !== null ? round(marginPct * 100 - a.baseline.marginPct, 2) : null,
      contributionPerInternalHour: st.internalHours + a.actuals.hours > EPS ? money(contribution.div(new D((st.internalHours + a.actuals.hours).toFixed(6)))) : null,
      cash: { peakFinancingNeed: money(minCum.neg()), timeToPositive: positiveFrom === null ? null : fromDay(positiveFrom), outstandingReceivable: money(exposure), netCash: money(cum) },
      warnings: st.warnings,
    };
    for (const code of st.warnings) warn(code.split(':')[0], `${a.title}: ${code}`, a.id);
    return eco;
  });

  /* ------------------------------------------------ company-level costs, payroll, overhead, actual AR/AP */
  const capacityCost = new Array<Dec>(M).fill(ZERO);
  for (const res of resources) {
    if (!res.r.internal || options.excludeCompanyCosts) continue;
    tl.monthRanges.forEach(([ms, me], m) => {
      const start = Math.max(ms, res.from); const end = Math.min(me, res.to);
      if (end < start) return;
      const ri = rateIndex(res.rates, start);
      const fixed = ri >= 0 ? res.rates.fixed[ri] : res.rates.fixed[0] ?? null;
      let cost: Dec;
      if (fixed) cost = fixed.times(end - start + 1).div(monthEnd(ms) - monthStart(ms) + 1);
      else {
        const hours = (res.r.weeklyHours / 5) * cal.workdays(start, end);
        cost = costAt(res, start, dec(config.rates.defaultInternalCostRate)).times(new D(hours.toFixed(6)));
        if (m === 0) warn('PAYROLL_FROM_RATE', `Resource "${res.r.name}" has no monthly fixed cost; capacity cost = cost rate × nominal hours`, res.r.id);
      }
      capacityCost[m] = capacityCost[m].plus(cost);
      if (inCash(me)) events.push({ day: me, amount: cost.neg(), category: 'PAYROLL', source: res.r.simulated ? 'SIMULATED' : 'FORECAST', label: res.r.name });
    });
  }
  const overheadMonthly = options.excludeCompanyCosts ? ZERO : sum(config.overhead.monthly.map((x) => dec(x.amount)));
  const overhead = tl.monthRanges.map(([ms, me]) => {
    let value = overheadMonthly.times(me - ms + 1).div(monthEnd(ms) - monthStart(ms) + 1);
    for (const extra of options.excludeCompanyCosts ? [] : snapshot.extraFixedCosts ?? []) {
      const s = Math.max(ms, toDay(extra.start)); const e = Math.min(me, extra.end ? toDay(extra.end) : me);
      if (e >= s) value = value.plus(dec(extra.monthly).times(e - s + 1).div(monthEnd(ms) - monthStart(ms) + 1));
    }
    if (!value.isZero() && inCash(me)) events.push({ day: me, amount: value.neg(), category: 'OVERHEAD', source: 'FORECAST', label: 'Overhead' });
    return value;
  });
  if (!config.overhead.monthly.length && !options.excludeCompanyCosts) warn('NO_OVERHEAD', 'No overhead is configured; operating result excludes indirect costs');
  for (const ar of options.excludeCompanyCosts ? [] : snapshot.openReceivables) {
    const due = toDay(ar.dueDate);
    const day = due < asOf ? asOf + config.cash.overdueCollectionDays : due;
    if (inCash(day)) events.push({ day, amount: dec(ar.amount), category: 'OPEN_RECEIVABLE', source: 'ACTUAL', label: `AR ${ar.id}` });
  }
  for (const ap of options.excludeCompanyCosts ? [] : snapshot.openPayables) {
    const day = Math.max(asOf, toDay(ap.dueDate));
    if (inCash(day)) events.push({ day, amount: dec(ap.amount).neg(), category: 'OPEN_PAYABLE', source: 'ACTUAL', label: `AP ${ap.id}` });
  }
  for (const [m, amount] of vatByMonth) {
    const pay = addMonths(m, config.vat.paymentLagMonths) + config.vat.paymentDay - 1;
    if (inCash(pay) && !amount.isZero()) events.push({ day: pay, amount: amount.neg(), category: 'VAT', source: 'FORECAST', label: 'VAT settlement' });
  }

  /* ------------------------------------------------ cash buckets */
  events.sort((x, y) => x.day - y.day || x.category.localeCompare(y.category));
  const opening = dec(snapshot.openingCash);
  const bucketCash = (ranges: [number, number][], periods: { key: string; start: string; end: string }[]): CashPeriod[] => {
    let balance = opening; let i = 0;
    return ranges.map(([s, e], index) => {
      let receipts = ZERO, payments = ZERO, vat = ZERO; let hasPipeline = false;
      while (i < events.length && events[i].day < s) i++;
      for (; i < events.length && events[i].day <= e; i++) {
        const ev = events[i];
        if (ev.category === 'VAT') vat = vat.plus(ev.amount);
        else if (ev.amount.isPositive()) receipts = receipts.plus(ev.amount); else payments = payments.plus(ev.amount);
        if (ev.source === 'WEIGHTED') hasPipeline = true;
      }
      const net = receipts.plus(payments).plus(vat); balance = balance.plus(net);
      return { ...periods[index], receipts: money(receipts), payments: money(payments.neg()), vat: money(vat.neg()), net: money(net), closing: money(balance),
        basis: hasPipeline ? 'WEIGHTED' : 'FORECAST' } as CashPeriod;
    });
  };
  let running = opening, minBalance = opening, minDay = asOf;
  for (const ev of events) { running = running.plus(ev.amount); if (running.lt(minBalance)) { minBalance = running; minDay = ev.day; } }
  const peakDeficit = D.max(ZERO, opening.minus(minBalance));
  const byCategory = new Map<string, Dec>();
  for (const ev of events) byCategory.set(ev.category, (byCategory.get(ev.category) ?? ZERO).plus(ev.amount));

  /* ------------------------------------------------ P&L by month (weighted by mode) */
  const pnl: PnlPeriod[] = tl.months.map((period, m) => {
    let contracted = ZERO, pipeline = ZERO, ext = ZERO, internal = ZERO;
    for (const st of assignments) {
      if (st.weight <= 0) continue;
      const w = new D(st.weight);
      const rev = st.monthRevenue[m].times(w);
      if (st.a.commitment === 'PIPELINE') pipeline = pipeline.plus(rev); else contracted = contracted.plus(rev);
      ext = ext.plus(st.monthExternal[m].plus(st.monthShortage[m]).plus(st.monthExpenses[m]).times(w));
      internal = internal.plus(st.monthInternal[m].times(w));
    }
    const revenue = contracted.plus(pipeline); const contribution = revenue.minus(ext).minus(internal);
    const unabsorbed = capacityCost[m].minus(internal);
    const actual = snapshot.actualInvoicedByMonth.find((x) => x.month === period.key);
    return { ...period, revenueContracted: money(contracted), revenuePipeline: money(pipeline), revenue: money(revenue), externalCost: money(ext), internalApplied: money(internal),
      contribution: money(contribution), capacityCost: money(capacityCost[m]), unabsorbedCapacity: money(unabsorbed), overhead: money(overhead[m]),
      operatingResult: money(contribution.minus(unabsorbed).minus(overhead[m])), actualInvoiced: actual ? actual.net : null };
  });
  const pnlSum = (key: keyof PnlPeriod) => sum(pnl.map((p) => dec(p[key] as string)));

  /* ------------------------------------------------ aggregates (weighted by mode) */
  const aggregate = (keyOf: (e: AssignmentEconomics) => [string, string] | null): Aggregate[] => {
    const map = new Map<string, { name: string; revenue: Dec; direct: Dec; hours: number; count: number }>();
    for (const e of economics) {
      if (e.weight <= 0) continue;
      const k = keyOf(e); if (!k) continue;
      const g = map.get(k[0]) ?? { name: k[1], revenue: ZERO, direct: ZERO, hours: 0, count: 0 };
      g.revenue = g.revenue.plus(dec(e.revenue).times(e.weight)); g.direct = g.direct.plus(dec(e.directCost).times(e.weight));
      g.hours += e.hoursAtCompletion * e.weight; g.count += 1; map.set(k[0], g);
    }
    return [...map.entries()].map(([key, g]) => ({ key, name: g.name, revenue: money(g.revenue), directCost: money(g.direct), contribution: money(g.revenue.minus(g.direct)),
      marginPct: ((r) => (r === null ? null : round(r * 100, 2)))(ratio(g.revenue.minus(g.direct), g.revenue)), hours: round(g.hours), count: g.count }))
      .sort((x, y) => dec(y.contribution).comparedTo(dec(x.contribution)));
  };
  const byClient = aggregate((e) => [e.clientId, e.clientName]);
  const totalClientRevenue = sum(byClient.map((c) => dec(c.revenue)));
  const topClient = byClient.length ? byClient.reduce((x, y) => (dec(y.revenue).gt(dec(x.revenue)) ? y : x)) : null;

  /* ------------------------------------------------ capacity results and bottlenecks */
  const weekMonth = tl.weekRanges.map(([s]) => tl.monthRanges.findIndex(([ms, me]) => s >= ms && s <= me));
  const bottlenecks: Bottleneck[] = [];
  const resourceCapacity: ResourceCapacity[] = resources.map((res) => {
    const total = (arr: number[]) => arr.reduce((x, y) => x + y, 0);
    const available = total(res.weekAvailable); const planned = total(res.weekPlanned);
    const excessByMonth = new Map<number, number>();
    res.weekPlanned.forEach((p, w) => { const excess = p - res.weekAvailable[w]; if (excess > 0.01) excessByMonth.set(weekMonth[w], (excessByMonth.get(weekMonth[w]) ?? 0) + excess); });
    for (const [m, excess] of excessByMonth) {
      bottlenecks.push({ kind: 'RESOURCE_OVERLOAD', id: res.r.id, name: res.r.name, periodKey: tl.months[m].key, excessHours: round(excess),
        assignmentIds: [...new Set(allLines.filter((l) => l.resource === res && l.weight > 0 && l.segHours.some((h, s) => h > EPS && tl.segments[s].month === m)).map((l) => l.a.id))] });
    }
    return { id: res.r.id, name: res.r.name, kind: res.r.kind, internal: res.r.internal, simulated: !!res.r.simulated,
      totals: { nominal: round(total(res.weekNominal)), absence: round(total(res.weekAbsence)), nonProject: round(total(res.weekNonProject)), available: round(available), planned: round(planned),
        billable: round(total(res.weekBillable)), utilization: available > EPS ? round(planned / available, 4) : null, billableUtilization: available > EPS ? round(total(res.weekBillable) / available, 4) : null },
      weeks: res.weekAvailable.map((av, w) => ({ available: round(av), planned: round(res.weekPlanned[w]), utilization: av > EPS ? round(res.weekPlanned[w] / av, 4) : null })) };
  });
  const skillCapacity: SkillCapacity[] = [...skillWeeks.entries()].map(([key, v]) => {
    const weeks = v.demand.map((dem, w) => ({ demand: round(dem), covered: round(v.covered[w]), shortage: round(Math.max(0, dem - v.covered[w])) }));
    const byMonth = new Map<number, number>();
    weeks.forEach((x, w) => { if (x.shortage > 0.01) byMonth.set(weekMonth[w], (byMonth.get(weekMonth[w]) ?? 0) + x.shortage); });
    const id = key === '*' ? null : key; const name = id ? skillName.get(id) ?? id : 'Any skill';
    for (const [m, excess] of byMonth) bottlenecks.push({ kind: 'SKILL_SHORTAGE', id, name, periodKey: tl.months[m].key, excessHours: round(excess),
      assignmentIds: [...new Set(allLines.filter((l) => l.pooled && l.weight > 0 && l.d.skillId === id && [...l.weekShares.entries()].some(([w, sh]) => weekMonth[w] === m && sh.shortage > EPS)).map((l) => l.a.id))] });
    return { skillId: id, name, weeks, totalShortage: round(weeks.reduce((x, y) => x + y.shortage, 0)) };
  }).sort((x, y) => y.totalShortage - x.totalShortage);
  bottlenecks.sort((x, y) => x.periodKey.localeCompare(y.periodKey) || y.excessHours - x.excessHours);

  const internalCaps = resourceCapacity.filter((r) => r.internal);
  const availableHours = internalCaps.reduce((x, r) => x + r.totals.available, 0);
  const plannedInternal = internalCaps.reduce((x, r) => x + r.totals.planned, 0);
  const revenueTotal = pnlSum('revenue'); const contributionTotal = pnlSum('contribution');
  const remainingOf = (e: AssignmentEconomics) => dec(e.remainingRevenue);

  return {
    engineVersion: ENGINE_VERSION, asOf: snapshot.asOf, mode, currency: snapshot.currency, calculatedAt: options.calculatedAt ?? new Date().toISOString(),
    illustrativeConfig: config.illustrative, months: tl.months, weeks: tl.weeks, assignments: economics,
    byService: aggregate((e) => [e.serviceId, e.serviceName]), byClient, byPackage: aggregate((e) => (e.packageId ? [e.packageId, e.packageId] : null)), pnl,
    totals: {
      backlog: money(sum(economics.filter((e) => e.commitment === 'CONTRACTED').map(remainingOf))),
      pipelineUnweighted: money(sum(economics.filter((e) => e.commitment === 'PIPELINE').map(remainingOf))),
      pipelineWeighted: money(sum(economics.filter((e) => e.commitment === 'PIPELINE').map((e) => remainingOf(e).times(e.probability)))),
      revenue: money(revenueTotal), directCost: money(pnlSum('externalCost').plus(pnlSum('internalApplied'))), contribution: money(contributionTotal),
      marginPct: ((r) => (r === null ? null : round(r * 100, 2)))(ratio(contributionTotal, revenueTotal)),
      capacityCost: money(pnlSum('capacityCost')), unabsorbedCapacity: money(pnlSum('unabsorbedCapacity')), overhead: money(pnlSum('overhead')), operatingResult: money(pnlSum('operatingResult')),
      internalHours: round(plannedInternal), availableHours: round(availableHours), utilization: availableHours > EPS ? round(plannedInternal / availableHours, 4) : null,
      shortageHours: round(skillCapacity.reduce((x, s) => x + s.totalShortage, 0)),
      topClientSharePct: topClient && totalClientRevenue.gt(0) ? round(dec(topClient.revenue).div(totalClientRevenue).toNumber() * 100, 2) : null,
    },
    capacity: { resources: resourceCapacity, skills: skillCapacity, bottlenecks },
    cash: {
      opening: money(opening), openingSource: snapshot.openingCashSource, months: bucketCash(tl.monthRanges, tl.months), weeks: bucketCash(tl.weekRanges, tl.weeks),
      minBalance: money(minBalance), minBalanceDate: fromDay(minDay), peakDeficit: money(peakDeficit),
      financingRequirement: money(D.max(ZERO, dec(config.cash.minCashReserve).minus(minBalance))), endBalance: money(running), eventCount: events.length,
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount: money(amount) })),
    },
    history: snapshot.actualInvoicedByMonth.map((x) => ({ month: x.month, invoicedNet: x.net })),
    warnings,
  };
}
