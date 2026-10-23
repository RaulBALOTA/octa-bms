import { describe, expect, it } from 'vitest';
import { benchmarkServices, evaluateAlerts, recalibrationProposals, ruleRecommendations, scoreServices, stats, type AttractivenessInput, type BenchmarkSample } from './intelligence';
import { computePortfolio } from './portfolio';
import { assignment, demand, resource, snapshot, testConfig } from './fixtures';

const config = testConfig();
const sample = (serviceId: string, planned: number, actual: number, i: number): BenchmarkSample => ({ serviceId, assignmentId: `${serviceId}-${i}`, plannedHours: planned, actualHours: actual,
  plannedCost: planned * 80, actualCost: actual * 80, plannedDays: 30, actualDays: 33, plannedMarginPct: 30, actualMarginPct: 25, completedAt: '2025-12-01' });

describe('benchmarks and recalibration', () => {
  it('computes robust statistics with outliers', () => {
    const s = stats([1, 1.1, 1.2, 1.15, 5]);
    expect(s).toMatchObject({ n: 5, median: 1.15, outliers: [5] });
    expect(stats([]).median).toBeNull();
  });
  it('distinguishes a two-project service from one with many comparable assignments', () => {
    const samples = [sample('few', 100, 150, 1), sample('few', 100, 140, 2), ...Array.from({ length: 20 }, (_, i) => sample('many', 100, 118 + (i % 5), i))];
    const [few, many] = benchmarkServices([{ id: 'few', code: 'F', name: 'Few' }, { id: 'many', code: 'M', name: 'Many' }], samples, config);
    expect(few).toMatchObject({ sampleCount: 2, sufficient: false, confidence: 'LOW' });
    expect(many).toMatchObject({ sampleCount: 20, sufficient: true, confidence: 'HIGH' });
    const proposals = recalibrationProposals([few, many], new Map([['few', 100], ['many', 200]]), samples, config);
    expect(proposals).toEqual([expect.objectContaining({ serviceId: 'many', currentValue: 200, proposedValue: 240, sampleCount: 20 })]);
  });
});

describe('service attractiveness', () => {
  const input = (values: Partial<AttractivenessInput>): AttractivenessInput => ({ serviceId: 's', code: 'S', name: 'S', lifecycle: 'CORE', completedSamples: 0, decidedOpportunities: 0,
    historicalMarginPct: null, forecastMarginPct: null, targetMarginPct: 30, cashRatio: null, contributionPerHour: null, weightedPipeline: null, winRate: null, externalShare: null, effortCv: null,
    assessments: { strategicImportance: 3 }, ...values });
  it('does not rank a service without history above a proven one because of optimistic assumptions', () => {
    const [proven, fresh] = scoreServices([
      input({ serviceId: 'proven', completedSamples: 20, decidedOpportunities: 20, historicalMarginPct: 40, forecastMarginPct: 40, contributionPerHour: 50, weightedPipeline: 100000, winRate: 0.5 }),
      input({ serviceId: 'fresh', completedSamples: 0, forecastMarginPct: 60, contributionPerHour: 60, weightedPipeline: 100000 }),
    ], config);
    expect(proven.total as number).toBeGreaterThan(fresh.total as number);
    expect(proven.confidence).toBeGreaterThan(fresh.confidence);
    expect(fresh.dimensions.find((d) => d.key === 'forecastMargin')?.basis).toBe('FORECAST');
  });
  it('flags insufficient data and suggests repricing below-target margins with strong demand', () => {
    expect(scoreServices([input({ assessments: {} })], config)[0].suggestedAction).toBe('INSUFFICIENT_DATA');
    const [r] = scoreServices([input({ completedSamples: 10, historicalMarginPct: 15, forecastMarginPct: 15, weightedPipeline: 1, targetMarginPct: 30 })], config);
    expect(r.suggestedAction).toBe('REPRICE');
  });
});

describe('alerts and rule-based recommendations', () => {
  const snap = snapshot({ config: testConfig({ cash: { minCashReserve: '10000.00' } }), openingCash: '0.00', skills: [{ id: 'pm', name: 'PM', parentId: null }], resources: [resource('R', { monthlyFixedCost: '6000.00' })],
    assignments: [
      assignment('H', { fixedFee: '20000.00', responsibleUserId: 'u1', baseline: { revenue: '20000.00', directCost: '8000.00', hours: 100, marginPct: 60 },
        actuals: { hours: 120, cost: '9600.00', revenue: '10000.00', invoicedNet: '10000.00', percentComplete: null }, demand: [demand('d', { hours: 100, actualHours: 120, remainingHours: 100, resourceId: 'R' })] }),
      assignment('U', { fixedFee: '5000.00', demand: [demand('u', { hours: 160, skillId: 'pm' })] }),
    ] });
  const result = computePortfolio(snap, 'EXPECTED');
  const alerts = evaluateAlerts(snap, result, [{ id: 'inv', invoiceNumber: 'R-1', clientName: 'Client', open: '1190.00', overdueDays: 75 }]);
  it('identifies hours overrun, negative margin, unfilled demand, overdue collection and low cash', () => {
    const codes = alerts.map((a) => a.ruleCode);
    expect(codes).toEqual(expect.arrayContaining(['HOURS_OVERRUN', 'UNFILLED_DEMAND', 'COLLECTION_OVERDUE', 'CASH_BELOW_RESERVE']));
    expect(alerts.find((a) => a.ruleCode === 'HOURS_OVERRUN')).toMatchObject({ severity: 'CRITICAL', ownerUserId: 'u1', dedupeKey: 'HOURS_OVERRUN:H' });
    expect(alerts.find((a) => a.ruleCode === 'COLLECTION_OVERDUE')?.severity).toBe('CRITICAL');
    expect(new Set(alerts.map((a) => a.dedupeKey)).size).toBe(alerts.length);
  });
  it('produces grounded recommendations without AI', () => {
    const recs = ruleRecommendations(snap, result, []);
    expect(recs.map((r) => r.title)).toEqual(expect.arrayContaining(['Close the PM capacity gap', 'Secure liquidity for the forecast cash low point']));
    expect(recs.every((r) => r.confidence === 'LOW' || r.confidence === 'HIGH')).toBe(true); // illustrative settings lower confidence
  });
});
