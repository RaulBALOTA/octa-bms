import type {
  AttractivenessDimension, BenchmarkStats, EngineConfig, EngineSnapshot, PortfolioResult, ServiceAttractiveness, ServiceBenchmark,
} from '../../../../../../packages/shared/src/business-engine';
import { dec, money, round } from './money';
import { toDay } from './calendar';

/* ================================================================== benchmarks */

export function stats(values: number[]): BenchmarkStats {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b); const n = s.length;
  if (!n) return { n: 0, mean: null, median: null, p10: null, p25: null, p75: null, p90: null, stdev: null, cv: null, outliers: [] };
  const q = (p: number) => { const i = (n - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(n - 1, lo + 1)] - s[lo]) * (i - lo); };
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const stdev = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const r = (x: number) => round(x, 4);
  return { n, mean: r(mean), median: r(q(0.5)), p10: r(q(0.1)), p25: r(q1), p75: r(q3), p90: r(q(0.9)), stdev: stdev === null ? null : r(stdev),
    cv: stdev === null || Math.abs(mean) < 1e-9 ? null : r(stdev / Math.abs(mean)), outliers: n >= 4 ? s.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).map(r) : [] };
}

export interface BenchmarkSample {
  serviceId: string; assignmentId: string; plannedHours: number; actualHours: number; plannedCost: number; actualCost: number;
  plannedDays: number; actualDays: number; plannedMarginPct: number | null; actualMarginPct: number | null; completedAt: string;
}

export function benchmarkServices(services: { id: string; code: string; name: string }[], samples: BenchmarkSample[], config: EngineConfig): ServiceBenchmark[] {
  return services.map((service) => {
    const own = samples.filter((x) => x.serviceId === service.id && x.plannedHours > 0 && x.actualHours > 0);
    const effort = stats(own.map((x) => x.actualHours / x.plannedHours));
    const n = own.length; const min = config.benchmarks.minSamples;
    let confidence: ServiceBenchmark['confidence'] = n === 0 ? 'NONE' : n < min ? 'LOW' : n < 3 * min ? 'MEDIUM' : 'HIGH';
    if (effort.cv !== null && effort.cv > 0.5 && confidence !== 'NONE') confidence = confidence === 'HIGH' ? 'MEDIUM' : 'LOW';
    return { serviceId: service.id, code: service.code, name: service.name, sampleCount: n, sufficient: n >= min, effortRatio: effort,
      costRatio: stats(own.filter((x) => x.plannedCost > 0).map((x) => x.actualCost / x.plannedCost)),
      durationRatio: stats(own.filter((x) => x.plannedDays > 0).map((x) => x.actualDays / x.plannedDays)),
      marginDeltaPts: stats(own.filter((x) => x.plannedMarginPct !== null && x.actualMarginPct !== null).map((x) => (x.actualMarginPct as number) - (x.plannedMarginPct as number))),
      actualHours: stats(own.map((x) => x.actualHours)), confidence };
  });
}

/**
 * Recalibration proposals: only for services with a sufficient sample and a material, outlier-robust
 * deviation. Proposals are never applied automatically.
 */
export function recalibrationProposals(benchmarks: ServiceBenchmark[], templates: Map<string, number>, samples: BenchmarkSample[], config: EngineConfig) {
  return benchmarks.flatMap((b) => {
    const current = templates.get(b.serviceId);
    if (!b.sufficient || !current || b.effortRatio.median === null) return [];
    const ratios = samples.filter((x) => x.serviceId === b.serviceId && x.plannedHours > 0 && x.actualHours > 0).map((x) => x.actualHours / x.plannedHours)
      .filter((x) => !b.effortRatio.outliers.includes(round(x, 4)));
    const robust = stats(ratios).median as number;
    if (Math.abs(robust - 1) * 100 < config.benchmarks.recalibrationThresholdPct) return [];
    return [{ serviceId: b.serviceId, metric: 'EFFORT_HOURS', currentValue: round(current), proposedValue: round(current * robust), sampleCount: ratios.length,
      statistics: { ...b.effortRatio, robustMedianExcludingOutliers: round(robust, 4), confidence: b.confidence } }];
  });
}

/* ================================================================== attractiveness */

export interface AttractivenessInput {
  serviceId: string; code: string; name: string; lifecycle: string; completedSamples: number; decidedOpportunities: number;
  historicalMarginPct: number | null; forecastMarginPct: number | null; targetMarginPct: number | null; cashRatio: number | null; contributionPerHour: number | null;
  weightedPipeline: number | null; winRate: number | null; externalShare: number | null; effortCv: number | null;
  assessments: Partial<Record<'repeatability' | 'scalability' | 'crossSelling' | 'strategicImportance' | 'referenceValue' | 'commercialRisk' | 'technicalRisk', number | null>>;
}

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const marginScale = (m: number) => clamp(((m + 10) / 70) * 100); // −10 % → 0, 60 % → 100 (absolute scale, stable across portfolios)

export function scoreServices(inputs: AttractivenessInput[], config: EngineConfig): ServiceAttractiveness[] {
  const k = config.scoring.priorStrength; const weights = config.scoring.weights;
  const maxCph = Math.max(0, ...inputs.map((x) => x.contributionPerHour ?? 0));
  const maxDemand = Math.max(0, ...inputs.map((x) => x.weightedPipeline ?? 0));
  const shrink = (score: number, n: number) => (n * score + k * 50) / (n + k);
  return inputs.map((x) => {
    const n = x.completedSamples;
    const assess = (v: number | null | undefined, invert = false) => (v === null || v === undefined ? null : clamp(((invert ? 5 - v : v - 1) / 4) * 100));
    const dims: ServiceAttractiveness['dimensions'] = [
      { key: 'historicalMargin', raw: x.historicalMarginPct, score: x.historicalMarginPct === null ? null : shrink(marginScale(x.historicalMarginPct), n), basis: x.historicalMarginPct === null ? 'MISSING' : 'OBSERVED', weight: weights.historicalMargin },
      { key: 'forecastMargin', raw: x.forecastMarginPct, score: x.forecastMarginPct === null ? null : shrink(marginScale(x.forecastMarginPct), n), basis: x.forecastMarginPct === null ? 'MISSING' : 'FORECAST', weight: weights.forecastMargin },
      { key: 'cash', raw: x.cashRatio, score: x.cashRatio === null ? null : shrink(clamp(100 - x.cashRatio * 200), n), basis: x.cashRatio === null ? 'MISSING' : 'FORECAST', weight: weights.cash },
      { key: 'capacityEfficiency', raw: x.contributionPerHour, score: x.contributionPerHour === null || maxCph <= 0 ? null : shrink(clamp((x.contributionPerHour / maxCph) * 100), n), basis: x.contributionPerHour === null ? 'MISSING' : n ? 'OBSERVED' : 'FORECAST', weight: weights.capacityEfficiency },
      { key: 'demand', raw: x.weightedPipeline, score: x.weightedPipeline === null || maxDemand <= 0 ? null : clamp((x.weightedPipeline / maxDemand) * 100), basis: x.weightedPipeline === null ? 'MISSING' : 'FORECAST', weight: weights.demand },
      { key: 'winRate', raw: x.winRate, score: x.winRate === null ? null : shrink(x.winRate * 100, x.decidedOpportunities), basis: x.winRate === null ? 'MISSING' : 'OBSERVED', weight: weights.winRate },
      ...(['repeatability', 'scalability', 'crossSelling', 'strategicImportance', 'referenceValue'] as const).map((key) => ({ key, raw: x.assessments[key] ?? null, score: assess(x.assessments[key]),
        basis: (x.assessments[key] ? 'ASSESSMENT' : 'MISSING') as 'ASSESSMENT' | 'MISSING', weight: weights[key] })),
      ...(['commercialRisk', 'technicalRisk'] as const).map((key) => ({ key, raw: x.assessments[key] ?? null, score: assess(x.assessments[key], true),
        basis: (x.assessments[key] ? 'ASSESSMENT' : 'MISSING') as 'ASSESSMENT' | 'MISSING', weight: weights[key] })),
    ].map((d) => ({ ...d, score: d.score === null ? null : round(d.score, 1) })) as ServiceAttractiveness['dimensions'];
    const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
    const available = dims.filter((d) => d.score !== null && d.weight > 0);
    const coverage = totalWeight > 0 ? available.reduce((s, d) => s + d.weight, 0) / totalWeight : 0;
    const total = coverage >= 0.3 ? round(available.reduce((s, d) => s + d.weight * (d.score as number), 0) / available.reduce((s, d) => s + d.weight, 0), 1) : null;
    const confidence = round(coverage * (0.5 + 0.5 * (n / (n + Math.max(k, 1)))), 3);
    const rationale: string[] = [];
    const margin = x.historicalMarginPct ?? x.forecastMarginPct;
    const dimScore = (key: AttractivenessDimension) => dims.find((d) => d.key === key)?.score ?? null;
    let action: ServiceAttractiveness['suggestedAction'];
    if (total === null || (n === 0 && x.forecastMarginPct === null)) { action = 'INSUFFICIENT_DATA'; rationale.push('Not enough observed or forecast data for a reliable assessment'); }
    else if (margin !== null && margin < 0) { action = n >= config.benchmarks.minSamples && (dimScore('demand') ?? 0) < 30 ? 'RETIRE' : 'REDUCE_EXPOSURE'; rationale.push(`Negative margin (${margin} %)`); }
    else if (margin !== null && x.targetMarginPct !== null && margin < x.targetMarginPct - 5 && (dimScore('demand') ?? 0) >= 60) { action = 'REPRICE'; rationale.push(`Margin ${margin} % below target ${x.targetMarginPct} % while demand is strong`); }
    else if (x.effortCv !== null && x.effortCv > 0.4) { action = 'STANDARDIZE'; rationale.push(`High effort variability (CV ${x.effortCv})`); }
    else if ((dimScore('capacityEfficiency') ?? 100) < 40 && (x.externalShare ?? 0) > 0.4) { action = 'PARTNER'; rationale.push('Low contribution per internal hour and high external share'); }
    else if ((x.assessments.repeatability ?? 0) >= 4 && (x.assessments.scalability ?? 5) <= 2) { action = 'AUTOMATE'; rationale.push('Highly repeatable but poorly scalable delivery'); }
    else if (total >= 70) action = 'INVEST'; else if (total >= 55) action = 'PROMOTE'; else if (total >= 40) action = 'MAINTAIN';
    else action = n >= config.benchmarks.minSamples ? 'RETIRE' : 'REDUCE_EXPOSURE';
    if (n < config.benchmarks.minSamples) rationale.push(`Only ${n} completed assignment(s); observed scores are shrunk toward neutral (prior strength ${k})`);
    if (x.lifecycle === 'RETIRED') rationale.push('Service is retired');
    return { serviceId: x.serviceId, code: x.code, name: x.name, total, confidence, sampleCount: n, dimensions: dims, suggestedAction: action, rationale };
  });
}

/* ================================================================== alerts */

export interface AlertCandidate {
  ruleCode: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; entityType: string; entityId: string; dedupeKey: string; title: string; detail: string;
  metric: Record<string, unknown>; ownerUserId: string | null;
}
export interface OverdueInvoice { id: string; invoiceNumber: string; clientName: string; open: string; overdueDays: number }

export function evaluateAlerts(snapshot: EngineSnapshot, result: PortfolioResult, overdue: OverdueInvoice[]): AlertCandidate[] {
  const cfg = snapshot.config.alerts; const out: AlertCandidate[] = [];
  const push = (a: Omit<AlertCandidate, 'dedupeKey'>) => out.push({ ...a, dedupeKey: `${a.ruleCode}:${a.entityId}` });
  const owner = new Map(snapshot.assignments.map((a) => [a.id, a.responsibleUserId]));
  for (const e of result.assignments) {
    if (e.commitment !== 'CONTRACTED') continue;
    const baseHours = snapshot.assignments.find((a) => a.id === e.id)?.baseline?.hours ?? e.plannedHours;
    if (baseHours > 0 && e.hoursAtCompletion > baseHours * (1 + cfg.hoursOverrunPct / 100)) {
      const pct = round((e.hoursAtCompletion / baseHours - 1) * 100, 1);
      push({ ruleCode: 'HOURS_OVERRUN', severity: pct > 2 * cfg.hoursOverrunPct ? 'CRITICAL' : 'WARNING', entityType: 'assignment', entityId: e.id,
        title: `Hours overrun ${pct} %: ${e.title}`, detail: `Forecast ${e.hoursAtCompletion} h at completion vs ${baseHours} h baseline (actual ${e.actualHours} h).`,
        metric: { baselineHours: baseHours, hoursAtCompletion: e.hoursAtCompletion, overrunPct: pct }, ownerUserId: owner.get(e.id) ?? null });
    }
    if (e.marginPct !== null && e.marginPct < 0) push({ ruleCode: 'NEGATIVE_MARGIN', severity: 'CRITICAL', entityType: 'assignment', entityId: e.id, title: `Negative margin: ${e.title}`,
      detail: `Forecast contribution ${e.contribution} ${result.currency} (${e.marginPct} %).`, metric: { contribution: e.contribution, marginPct: e.marginPct }, ownerUserId: owner.get(e.id) ?? null });
    else if (e.marginVariancePts !== null && e.marginVariancePts < -cfg.marginErosionPts) push({ ruleCode: 'MARGIN_EROSION', severity: 'WARNING', entityType: 'assignment', entityId: e.id,
      title: `Margin erosion ${e.marginVariancePts} pts: ${e.title}`, detail: `Forecast margin ${e.marginPct} % vs baseline ${e.baselineMarginPct} %.`,
      metric: { marginPct: e.marginPct, baselineMarginPct: e.baselineMarginPct }, ownerUserId: owner.get(e.id) ?? null });
  }
  const horizonWeeks = result.weeks.slice(0, cfg.unfilledWeeksAhead);
  const lastKey = horizonWeeks.at(-1)?.end ?? result.asOf;
  const monthsAhead = new Set(result.months.filter((m) => m.start <= lastKey).map((m) => m.key));
  for (const sk of result.capacity.skills) {
    const hours = sk.weeks.slice(0, cfg.unfilledWeeksAhead).reduce((s, w) => s + w.shortage, 0);
    if (hours <= cfg.unfilledHoursThreshold) continue;
    const affected = result.capacity.bottlenecks.filter((b) => b.kind === 'SKILL_SHORTAGE' && b.id === sk.skillId && monthsAhead.has(b.periodKey)).flatMap((b) => b.assignmentIds);
    const contracted = [...new Set(affected)].filter((id) => result.assignments.find((a) => a.id === id)?.commitment === 'CONTRACTED');
    push({ ruleCode: 'UNFILLED_DEMAND', severity: contracted.length ? 'CRITICAL' : 'WARNING', entityType: 'skill', entityId: sk.skillId ?? 'any',
      title: `Unfilled ${sk.name} demand: ${round(hours)} h in the next ${cfg.unfilledWeeksAhead} weeks`, detail: contracted.length ? `Threatens contracted assignments: ${contracted.length}.` : 'Pipeline demand only.',
      metric: { shortageHours: round(hours), assignmentIds: [...new Set(affected)] }, ownerUserId: null });
  }
  for (const res of result.capacity.resources) {
    const weeks = res.weeks.slice(0, cfg.unfilledWeeksAhead).map((w, i) => ({ i, ...w })).filter((w) => w.available > 0 ? w.planned > w.available * (1 + cfg.overloadPct / 100) : w.planned > 0.01);
    if (!weeks.length) continue;
    const excess = weeks.reduce((s, w) => s + w.planned - w.available, 0);
    push({ ruleCode: 'RESOURCE_OVERLOAD', severity: 'WARNING', entityType: 'resource', entityId: res.id, title: `${res.name} over-allocated in ${weeks.length} week(s)`,
      detail: `${round(excess)} h above available capacity within ${cfg.unfilledWeeksAhead} weeks (weeks ${weeks.map((w) => result.weeks[w.i].key).join(', ')}).`,
      metric: { excessHours: round(excess), weeks: weeks.map((w) => result.weeks[w.i].key) }, ownerUserId: null });
  }
  for (const inv of overdue) if (inv.overdueDays > cfg.overdueDays) push({ ruleCode: 'COLLECTION_OVERDUE', severity: inv.overdueDays > 2 * cfg.overdueDays ? 'CRITICAL' : 'WARNING',
    entityType: 'invoice', entityId: inv.id, title: `Invoice ${inv.invoiceNumber} overdue ${inv.overdueDays} days`, detail: `${inv.clientName}: ${inv.open} ${result.currency} open.`,
    metric: { open: inv.open, overdueDays: inv.overdueDays }, ownerUserId: null });
  if (dec(result.cash.minBalance).lt(dec(snapshot.config.cash.minCashReserve))) push({ ruleCode: 'CASH_BELOW_RESERVE', severity: 'CRITICAL', entityType: 'company', entityId: 'cash',
    title: `Forecast cash below reserve on ${result.cash.minBalanceDate}`, detail: `Minimum ${result.cash.minBalance} vs reserve ${snapshot.config.cash.minCashReserve} ${result.currency} (${result.mode}).`,
    metric: { minBalance: result.cash.minBalance, minBalanceDate: result.cash.minBalanceDate, financingRequirement: result.cash.financingRequirement }, ownerUserId: null });
  if (result.totals.topClientSharePct !== null && result.totals.topClientSharePct > cfg.concentrationPct && result.byClient.length > 0) push({ ruleCode: 'CLIENT_CONCENTRATION', severity: 'WARNING',
    entityType: 'client', entityId: result.byClient.reduce((x, y) => (Number(y.revenue) > Number(x.revenue) ? y : x)).key,
    title: `Client concentration ${result.totals.topClientSharePct} %`, detail: `Largest client exceeds ${cfg.concentrationPct} % of forecast revenue.`, metric: { sharePct: result.totals.topClientSharePct }, ownerUserId: null });
  const asOf = toDay(snapshot.asOf);
  for (const r of snapshot.resources) {
    if (r.kind === 'MANAGEMENT') {
      const byAssignment = new Map<string, number>(); let total = 0;
      for (const a of snapshot.assignments) for (const d of a.demand) if (d.resourceId === r.id) { const h = d.remainingHours ?? Math.max(0, d.hours - d.actualHours); byAssignment.set(a.id, (byAssignment.get(a.id) ?? 0) + h); total += h; }
      for (const [id, h] of byAssignment) if (total > 0 && (h / total) * 100 > cfg.seniorSharePct && byAssignment.size > 1) push({ ruleCode: 'SENIOR_TIME', severity: 'INFO', entityType: 'assignment', entityId: id,
        title: `${r.name}: ${round((h / total) * 100, 1)} % of remaining management time on one assignment`, detail: `${round(h)} of ${round(total)} remaining hours.`, metric: { hours: round(h), totalHours: round(total) }, ownerUserId: owner.get(id) ?? null });
    }
    const sorted = [...r.rates].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom));
    const current = [...sorted].reverse().find((x) => toDay(x.effectiveFrom) <= asOf);
    const next = sorted.find((x) => toDay(x.effectiveFrom) > asOf);
    if (current && next && dec(current.costRate).gt(0) && dec(next.costRate).div(dec(current.costRate)).minus(1).times(100).gt(cfg.rateIncreasePct)) {
      push({ ruleCode: 'RATE_INCREASE', severity: r.internal ? 'INFO' : 'WARNING', entityType: 'resource', entityId: r.id,
        title: `${r.name}: rate increase from ${next.effectiveFrom}`, detail: `${current.costRate} → ${next.costRate} per hour.`, metric: { from: current.costRate, to: next.costRate, effectiveFrom: next.effectiveFrom }, ownerUserId: null });
    }
  }
  return out;
}

/* ================================================================== rule-based recommendations (AI-independent) */

export interface RuleRecommendation {
  title: string; problem: string; evidence: Record<string, unknown>; proposedAction: string; estimatedBenefit: string | null; assumptions: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'; risks: string; responsibleRole: string; priority: 'LOW' | 'MEDIUM' | 'HIGH'; refs: { type: string; id: string }[];
}

export function ruleRecommendations(snapshot: EngineSnapshot, result: PortfolioResult, scores: ServiceAttractiveness[]): RuleRecommendation[] {
  const recs: RuleRecommendation[] = [];
  const base = snapshot.config.illustrative ? 'LOW' as const : 'MEDIUM' as const;
  const illustrative = snapshot.config.illustrative ? ' Engine settings are still illustrative defaults.' : '';
  for (const sk of result.capacity.skills.filter((s) => s.totalShortage > snapshot.config.alerts.unfilledHoursThreshold).slice(0, 5)) {
    const shortageCost = dec(snapshot.config.rates.shortageCostRate).times(sk.totalShortage);
    recs.push({ title: `Close the ${sk.name} capacity gap`, problem: `${sk.totalShortage} h of ${sk.name} demand cannot be covered by qualified available resources in the horizon (${result.mode}).`,
      evidence: { shortageHours: sk.totalShortage, months: result.capacity.bottlenecks.filter((b) => b.kind === 'SKILL_SHORTAGE' && b.id === sk.skillId).map((b) => ({ month: b.periodKey, hours: b.excessHours })) },
      proposedAction: 'Compare hiring, freelance and partner delivery in the make/buy analysis; simulate the preferred option as a scenario before committing.',
      estimatedBenefit: `Avoids ${money(shortageCost)} ${result.currency} priced at the configured shortage rate`, assumptions: `Shortage priced at ${snapshot.config.rates.shortageCostRate}/h.${illustrative}`,
      confidence: result.mode === 'CONTRACTED' ? 'HIGH' : base, risks: 'Pipeline-driven demand may not materialise; recruiting lead times.', responsibleRole: 'Resource Manager', priority: 'HIGH',
      refs: [...new Set(result.capacity.bottlenecks.filter((b) => b.id === sk.skillId).flatMap((b) => b.assignmentIds))].map((id) => ({ type: 'assignment', id })) });
  }
  if (dec(result.cash.financingRequirement).gt(0)) recs.push({ title: 'Secure liquidity for the forecast cash low point', problem: `Cash falls to ${result.cash.minBalance} on ${result.cash.minBalanceDate}, below the reserve.`,
    evidence: { minBalance: result.cash.minBalance, minBalanceDate: result.cash.minBalanceDate, financingRequirement: result.cash.financingRequirement, peakDeficit: result.cash.peakDeficit },
    proposedAction: 'Negotiate milestone or advance payments, accelerate collection of open receivables, or arrange a credit line; test payment-term scenarios.',
    estimatedBenefit: `Covers a financing requirement of ${result.cash.financingRequirement} ${result.currency}`, assumptions: `Opening cash source: ${result.cash.openingSource}.${illustrative}`,
    confidence: base, risks: 'Forecast depends on collection timing assumptions.', responsibleRole: 'Finance Manager', priority: 'HIGH', refs: [{ type: 'company', id: 'cash' }] });
  for (const e of result.assignments.filter((a) => a.commitment === 'CONTRACTED' && a.marginPct !== null && a.marginPct < 0).slice(0, 5)) recs.push({
    title: `Recover margin on ${e.title}`, problem: `Forecast contribution ${e.contribution} (${e.marginPct} %).`, evidence: { revenue: e.revenue, costAtCompletion: e.costAtCompletion, hoursVariance: e.hoursVariance },
    proposedAction: 'Reforecast remaining effort, check claimable scope changes (variation orders) and review the delivery plan.', estimatedBenefit: null, assumptions: 'Based on current remaining-hours forecast.',
    confidence: 'HIGH', risks: 'Client relationship impact of renegotiation.', responsibleRole: 'Project Manager', priority: 'HIGH', refs: [{ type: 'assignment', id: e.id }] });
  for (const s of scores.filter((x) => ['REPRICE', 'RETIRE', 'INVEST', 'PARTNER', 'STANDARDIZE'].includes(x.suggestedAction))) recs.push({
    title: `${s.suggestedAction.charAt(0)}${s.suggestedAction.slice(1).toLowerCase()} service ${s.code} ${s.name}`, problem: s.rationale.join('; ') || `Attractiveness score ${s.total}`,
    evidence: { total: s.total, confidence: s.confidence, sampleCount: s.sampleCount, dimensions: s.dimensions.filter((d) => d.score !== null).map((d) => ({ key: d.key, score: d.score, basis: d.basis })) },
    proposedAction: `Review service ${s.code} with its owner: ${s.suggestedAction}.`, estimatedBenefit: null, assumptions: 'Scores combine observed results and management assessments using configured weights.',
    confidence: s.confidence >= 0.6 ? 'HIGH' : s.confidence >= 0.35 ? 'MEDIUM' : 'LOW', risks: 'Small samples can mislead; check comparability of assignments.', responsibleRole: 'Service Owner',
    priority: s.suggestedAction === 'RETIRE' || s.suggestedAction === 'REPRICE' ? 'MEDIUM' : 'LOW', refs: [{ type: 'service', id: s.serviceId }] });
  if (result.totals.topClientSharePct !== null && result.totals.topClientSharePct > snapshot.config.alerts.concentrationPct) recs.push({
    title: 'Reduce client concentration', problem: `The largest client accounts for ${result.totals.topClientSharePct} % of forecast revenue.`, evidence: { topClients: result.byClient.slice(0, 3) },
    proposedAction: 'Prioritise pipeline opportunities with other clients; consider credit risk limits for the largest client.', estimatedBenefit: null, assumptions: `Threshold ${snapshot.config.alerts.concentrationPct} %.`,
    confidence: base, risks: 'Diversification may lower short-term margin.', responsibleRole: 'Managing Director', priority: 'MEDIUM', refs: result.byClient.slice(0, 1).map((c) => ({ type: 'client', id: c.key })) });
  if (result.totals.utilization !== null && result.totals.utilization < 0.6 && result.totals.availableHours > 0) recs.push({
    title: 'Use idle internal capacity', problem: `Planned internal utilization is ${round(result.totals.utilization * 100, 1)} %; unabsorbed capacity cost ${result.totals.unabsorbedCapacity} ${result.currency}.`,
    evidence: { utilization: result.totals.utilization, unabsorbedCapacity: result.totals.unabsorbedCapacity }, proposedAction: 'Bring externally sourced scope in-house and prioritise opportunities matching idle skills (run the optimizer).',
    estimatedBenefit: null, assumptions: 'Utilization measured against available delivery capacity, not paid hours.', confidence: base, risks: 'Pipeline may fill capacity later.', responsibleRole: 'Resource Manager', priority: 'MEDIUM', refs: [] });
  return recs;
}
