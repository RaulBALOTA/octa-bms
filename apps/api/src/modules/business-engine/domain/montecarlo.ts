import type { DistributionSummary, EngineSnapshot, MonteCarloResult, Triangular } from '../../../../../../packages/shared/src/business-engine';
import { applyOperations, scenarioMetrics } from './scenario';
import { computePortfolio } from './portfolio';
import { addDays } from './calendar';
import { dec } from './money';

/** Reproducible PRNG (mulberry32). */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(rand: () => number) { const u = Math.max(rand(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }
/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
export function triangular(u: number, { min, mode, max }: Triangular) {
  if (max === min) return min;
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}
export function summarize(values: number[]): DistributionSummary {
  const s = [...values].sort((a, b) => a - b); const n = s.length;
  const q = (p: number) => { if (!n) return 0; const i = (n - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(n - 1, lo + 1)] - s[lo]) * (i - lo); };
  const r = (x: number) => Math.round(x * 100) / 100;
  return { mean: r(n ? s.reduce((a, b) => a + b, 0) / n : 0), p5: r(q(0.05)), p10: r(q(0.1)), p50: r(q(0.5)), p90: r(q(0.9)), p95: r(q(0.95)), min: r(s[0] ?? 0), max: r(s[n - 1] ?? 0) };
}

/**
 * Monte Carlo over award, start delay, effort and collection uncertainty.
 * Dependence: award outcomes share one common market factor and effort deviations share one common
 * delivery factor (one-factor Gaussian copula with correlation ρ) — drivers are NOT assumed independent.
 * Mutually exclusive alternatives (same exclusiveGroup) can never be won together.
 */
export function monteCarlo(snapshot: EngineSnapshot, iterations: number, seed: number, shouldStop: () => boolean = () => false): MonteCarloResult {
  const steps = monteCarloSteps(snapshot, iterations, seed, shouldStop);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/** Same simulation, yielding to the event loop every `chunk` iterations so runs can be cancelled. */
export async function monteCarloAsync(snapshot: EngineSnapshot, iterations: number, seed: number, shouldStop: () => boolean, onProgress?: (done: number) => void, chunk = 5): Promise<MonteCarloResult> {
  const steps = monteCarloSteps(snapshot, iterations, seed, shouldStop);
  for (let i = 0; ; i++) {
    const next = steps.next();
    if (next.done) return next.value;
    if (i % chunk === 0) { onProgress?.(next.value); await new Promise((resolve) => setImmediate(resolve)); }
  }
}

function* monteCarloSteps(snapshot: EngineSnapshot, iterations: number, seed: number, shouldStop: () => boolean): Generator<number, MonteCarloResult, void> {
  const cfg = snapshot.config.monteCarlo; const rho = cfg.correlation;
  const rand = prng(seed);
  const reserve = Number(snapshot.config.cash.minCashReserve);
  const out = { revenue: [] as number[], contribution: [] as number[], operating: [] as number[], minCash: [] as number[], shortage: [] as number[] };
  let negativeCash = 0, belowReserve = 0, overload = 0, negativeResult = 0, done = 0;
  const pipeline = snapshot.assignments.filter((a) => a.commitment === 'PIPELINE');
  for (let it = 0; it < iterations; it++) {
    if (shouldStop()) break;
    const market = normal(rand); const delivery = normal(rand);
    const correlated = (common: number) => phi(Math.sqrt(rho) * common + Math.sqrt(1 - rho) * normal(rand));
    const won = new Set<string>();
    const groups = new Map<string, typeof pipeline>();
    for (const a of pipeline) {
      if (a.exclusiveGroup) { groups.set(a.exclusiveGroup, [...(groups.get(a.exclusiveGroup) ?? []), a]); continue; }
      if (correlated(market) < a.probability) won.add(a.id);
    }
    for (const members of groups.values()) {
      const total = Math.max(1, members.reduce((s, a) => s + a.probability, 0));
      const u = correlated(market); let acc = 0;
      for (const a of members) { acc += a.probability / total; if (u < acc) { won.add(a.id); break; } }
    }
    // An empty assignmentIds list would select everything, so only emit operations with targets.
    const lost = pipeline.filter((a) => !won.has(a.id)).map((a) => a.id);
    const trial = applyOperations(snapshot, [
      ...(lost.length ? [{ type: 'LOSE' as const, assignmentIds: lost }] : []),
      ...(won.size ? [{ type: 'WIN' as const, assignmentIds: [...won] }] : []),
    ]).snapshot;
    for (const a of trial.assignments) {
      if (won.has(a.id)) {
        const delay = Math.round(triangular(rand(), cfg.startDelayDays));
        if (delay) { a.start = addDays(a.start, delay); a.end = addDays(a.end, delay); for (const d of a.demand) { if (d.start) d.start = addDays(d.start, delay); if (d.end) d.end = addDays(d.end, delay); } for (const m of a.milestones) if (!m.invoiced) m.date = addDays(m.date, delay); }
      }
      const effort = triangular(correlated(delivery), cfg.effortFactor);
      for (const d of a.demand) { const rem = d.remainingHours ?? Math.max(0, d.hours - d.actualHours); d.remainingHours = rem * effort; }
      a.collectionDelayDays = (a.collectionDelayDays ?? 0) + Math.round(triangular(rand(), cfg.collectionDelayDays));
    }
    const m = scenarioMetrics(computePortfolio(trial, 'CONTRACTED', { calculatedAt: 'monte-carlo' }));
    const minCash = Number(m.minCash); const operating = Number(m.operatingResult);
    out.revenue.push(Number(m.revenue)); out.contribution.push(Number(m.contribution)); out.operating.push(operating); out.minCash.push(minCash); out.shortage.push(m.shortageHours);
    if (minCash < 0) negativeCash++; if (dec(m.minCash).lt(reserve)) belowReserve++; if (m.shortageHours > 0.01 || m.overloadCount > 0) overload++; if (operating < 0) negativeResult++;
    done++;
    yield done;
  }
  const p = (count: number) => (done ? Math.round((count / done) * 10000) / 10000 : 0);
  return {
    iterations: done, seed, correlation: rho, labelling: 'SIMULATED',
    revenue: summarize(out.revenue), contribution: summarize(out.contribution), operatingResult: summarize(out.operating), minCash: summarize(out.minCash), shortageHours: summarize(out.shortage),
    probabilityNegativeCash: p(negativeCash), probabilityBelowReserve: p(belowReserve), probabilityCapacityOverload: p(overload), probabilityNegativeOperatingResult: p(negativeResult),
    assumptions: [
      `Award: Bernoulli per opportunity with its probability; common market factor ρ = ${rho}`,
      `Start delay (won opportunities): triangular ${cfg.startDelayDays.min}/${cfg.startDelayDays.mode}/${cfg.startDelayDays.max} days`,
      `Remaining effort factor: triangular ${cfg.effortFactor.min}/${cfg.effortFactor.mode}/${cfg.effortFactor.max}, common delivery factor ρ = ${rho}`,
      `Additional collection delay: triangular ${cfg.collectionDelayDays.min}/${cfg.collectionDelayDays.mode}/${cfg.collectionDelayDays.max} days`,
      'Rates, overhead and payroll are held at their configured values',
      `${done} iterations — percentiles below p5/p95 are not reported because they are unreliable at this sample size`,
    ],
  };
}
