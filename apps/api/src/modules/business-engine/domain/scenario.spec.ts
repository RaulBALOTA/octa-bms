import { describe, expect, it } from 'vitest';
import { applyOperations, compareMetrics, runScenario, sensitivity } from './scenario';
import { monteCarlo, phi, prng, summarize, triangular } from './montecarlo';
import { compareSourcing } from './sourcing';
import { assignment, demand, resource, snapshot, testConfig } from './fixtures';

const pipeline = (id: string, fee: string, probability: number, extra: Record<string, unknown> = {}) =>
  assignment(id, { commitment: 'PIPELINE', probability, contractId: null, opportunityId: id, fixedFee: fee, ...extra });

describe('scenario isolation and operations', () => {
  const live = snapshot({ resources: [resource('R')], assignments: [assignment('C', { fixedFee: '50000.00', demand: [demand('d', { hours: 100, resourceId: 'R' })] }), pipeline('O', '30000.00', 0.4)] });
  it('never mutates the input snapshot', () => {
    const before = JSON.stringify(live);
    applyOperations(live, [{ type: 'WIN', opportunityId: 'O' }, { type: 'PRICE', pct: 10, includeContracted: true }, { type: 'HIRE', name: 'H', skillIds: [], weeklyHours: 40, start: '2026-02-02', monthlyFixedCost: '6000.00', costRate: '60.00' }]);
    expect(JSON.stringify(live)).toBe(before);
  });
  it('treats an operation without a target as affecting nothing', () => {
    const { log, snapshot: s } = applyOperations(live, [{ type: 'LOSE' }]);
    expect(log[0].affected).toBe(0);
    expect(s.assignments).toHaveLength(2);
  });
  it('refuses to "lose" contracted work and explains why', () => {
    const { log } = applyOperations(live, [{ type: 'LOSE', assignmentIds: ['C'] }]);
    expect(log[0]).toMatchObject({ affected: 0, note: expect.stringMatching(/contracted/) });
  });
  it('wins, loses, reprices and compares scenarios against the baseline', () => {
    const baseline = runScenario(live, [], 'EXPECTED').metrics;
    const win = runScenario(live, [{ type: 'WIN', opportunityId: 'O' }], 'EXPECTED').metrics;
    const lose = runScenario(live, [{ type: 'LOSE', opportunityId: 'O' }], 'EXPECTED').metrics;
    expect([baseline.revenue, win.revenue, lose.revenue]).toEqual(['62000.00', '80000.00', '50000.00']);
    const rows = compareMetrics(baseline, [win, lose]);
    expect(rows.find((r) => r.key === 'revenue')?.deltas).toEqual(['18000.00', '-12000.00']);
  });
  it('hiring adds payroll and capacity; a freelancer adds variable cost only', () => {
    const hire = runScenario(live, [{ type: 'HIRE', name: 'H', skillIds: [], weeklyHours: 40, start: '2026-01-05', monthlyFixedCost: '6000.00', costRate: '60.00', rampUpWeeks: 0 }], 'EXPECTED');
    const baseline = runScenario(live, [], 'EXPECTED');
    expect(Number(hire.metrics.fixedCostCommitment) - Number(baseline.metrics.fixedCostCommitment)).toBeCloseTo(6000 * 12 - 6000 * 4 / 31, 0);
    expect(hire.result.capacity.resources.find((r) => r.id.startsWith('sim-hire'))?.simulated).toBe(true);
  });
  it('payment delay worsens minimum cash without changing profit', () => {
    const s = snapshot({ asOf: '2026-01-01', horizonEnd: '2026-03-31', openingCash: '0.00', resources: [resource('R', { monthlyFixedCost: '5000.00' })], assignments: [assignment('P', { start: '2026-01-01', end: '2026-01-31', fixedFee: '20000.00' })] });
    const a = runScenario(s, [], 'EXPECTED').metrics; const b = runScenario(s, [{ type: 'PAYMENT_DELAY', days: 60 }], 'EXPECTED').metrics;
    expect(b.operatingResult).toBe(a.operatingResult);
    expect([a.minCash, b.minCash]).toEqual(['-10000.00', '-15000.00']); // receipt 2 March vs. after the horizon
  });
});

describe('sensitivity and break-even', () => {
  it('finds the price break-even of a loss-making opportunity', () => {
    const s = snapshot({ config: testConfig(), assignments: [pipeline('O', '10000.00', 1, { demand: [demand('d', { hours: 100, sourcing: 'EXTERNAL', externalRate: '120.00' })] })] });
    const r = sensitivity(s, 'EXPECTED', 'PRICE', [-10, 0, 10]);
    expect(r.steps.map((x) => x.metrics.contribution)).toEqual(['-3000.00', '-2000.00', '-1000.00']);
    expect(r.breakEven.find((b) => b.metric === 'contribution')?.pct).toBeCloseTo(20, 1); // 12,000 / 10,000 − 1
  });
  it('reports no break-even when the metric never changes sign', () => {
    const s = snapshot({ assignments: [assignment('C', { fixedFee: '10000.00' })] });
    expect(sensitivity(s, 'EXPECTED', 'HOURS', [0]).breakEven[0].pct).toBeNull();
  });
});

describe('Monte Carlo', () => {
  it('has reproducible random numbers and correct distribution helpers', () => {
    const a = prng(42); const b = prng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(phi(0)).toBeCloseTo(0.5, 6); expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(triangular(0, { min: 1, mode: 2, max: 4 })).toBe(1); expect(triangular(1, { min: 1, mode: 2, max: 4 })).toBe(4);
    expect(summarize([1, 2, 3, 4, 5])).toMatchObject({ p50: 3, mean: 3, min: 1, max: 5 });
  });
  it('reproduces results with the same seed and respects exclusive alternatives', () => {
    const s = snapshot({ config: testConfig({ monteCarlo: { effortFactor: { min: 1, mode: 1, max: 1 }, startDelayDays: { min: 0, mode: 0, max: 0 }, collectionDelayDays: { min: 0, mode: 0, max: 0 } } }),
      assignments: [pipeline('A', '100.00', 0.6, { exclusiveGroup: 'g' }), pipeline('B', '200.00', 0.4, { exclusiveGroup: 'g' })] });
    const r1 = monteCarlo(s, 300, 7); const r2 = monteCarlo(s, 300, 7);
    expect(r1).toEqual(r2);
    expect(r1.revenue.max).toBeLessThanOrEqual(200); // never both
    expect(r1.revenue.mean).toBeGreaterThan(100); expect(r1.revenue.mean).toBeLessThan(160); // E = 0.6·100 + 0.4·200 = 140
    expect(r1.labelling).toBe('SIMULATED');
  });
});

describe('Case D — make / buy: internal hire vs freelancer', () => {
  const config = testConfig({ hiring: { employerCostPct: 21, onboardingWeeks: 12, nonBillablePct: 20, recruitingCost: '0.00', annualProductiveWeeks: 46 } });
  const options = [
    { kind: 'HIRE' as const, label: 'Hire engineer', annualSalary: '70000.00', weeklyHours: 40, leadTimeWeeks: 12 },
    { kind: 'FREELANCE' as const, label: 'Freelancer', hourlyCost: '95.00', leadTimeWeeks: 2 },
  ];
  it('uses fully specified costs and utilization assumptions', () => {
    const r = compareSourcing({ demandHours: 1000, billRate: '120.00', options }, config);
    const hire = r.options[0];
    expect(hire.hiring).toMatchObject({ totalEmployerCost: '84700.00', productiveHours: 1472, rampUpLossHours: 144, breakEvenUtilizationPct: 47.95, breakEvenHoursVsFreelance: 891.58 });
    expect(hire.contribution).toBe('35300.00');
    expect(r.options[1].contribution).toBe('25000.00');
    expect(r.recommendation.label).toBe('Hire engineer');
  });
  it('prefers the freelancer at low demand and when the hire cannot start in time', () => {
    expect(compareSourcing({ demandHours: 500, billRate: '120.00', options }, config).recommendation.label).toBe('Freelancer');
    const urgent = compareSourcing({ demandHours: 1000, billRate: '120.00', requiredWithinWeeks: 4, options }, config);
    expect(urgent.options[0].feasible).toBe(false);
    expect(urgent.recommendation.label).toBe('Freelancer');
    expect(urgent.recommendation.risks.join(' ')).toMatch(/contractually responsible/);
  });
});
