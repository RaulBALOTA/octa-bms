import { describe, expect, it } from 'vitest';
import { computePortfolio } from './portfolio';
import { assignment, demand, resource, snapshot, testConfig } from './fixtures';
import { allocate, D } from './money';
import { WorkCalendar, buildTimeline, germanNationalHolidays, toDay, fromDay } from './calendar';
import { resolveConfig } from './config';

describe('money and time model', () => {
  it('allocates cents exactly with the largest remainder method, including negatives and zero weights', () => {
    expect(allocate(new D('100.00'), [1, 1, 1]).map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(allocate(new D('-0.05'), [1, 1]).map(String)).toEqual(['-0.03', '-0.02']);
    expect(allocate(new D('10'), [0, 0]).map(String)).toEqual(['0', '10']);
  });
  it('computes German national holidays and working days', () => {
    expect(germanNationalHolidays(2026).map(fromDay)).toEqual(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26']);
    const cal = new WorkCalendar(toDay('2026-01-01'), toDay('2026-12-31'), 'DE_NATIONAL');
    expect(cal.workdays(toDay('2026-01-01'), toDay('2026-01-31'))).toBe(21); // 22 weekdays − New Year
    expect(cal.workdays(toDay('2026-01-31'), toDay('2026-01-01'))).toBe(0);
  });
  it('builds weeks and months as exact unions of segments', () => {
    const tl = buildTimeline(toDay('2026-01-28'), toDay('2026-02-10'));
    expect(tl.weeks.map((w) => w.key)).toEqual(['2026-W05', '2026-W06', '2026-W07']);
    expect(tl.months.map((m) => m.key)).toEqual(['2026-01', '2026-02']);
    expect(tl.segments.map((s) => [fromDay(s.start), fromDay(s.end)])).toEqual([['2026-01-28', '2026-01-31'], ['2026-02-01', '2026-02-01'], ['2026-02-02', '2026-02-08'], ['2026-02-09', '2026-02-10']]);
  });
  it('rejects invalid configuration with a field path', () => {
    expect(() => resolveConfig({ vat: { ratePct: 200 } })).toThrow(/vat.ratePct/);
    expect(() => resolveConfig({ unknown: 1 })).toThrow(/unknown setting/);
    expect(() => resolveConfig({ optimization: { objectiveWeights: { CONTRIBUTION: 0 } } })).toThrow(/positive weight/);
  });
});

describe('Case A — small feasibility assignment', () => {
  const snap = snapshot({
    resources: [resource('R1', { costRate: '80.00' })],
    assignments: [assignment('A', { fixedFee: '25000.00', expenses: { travel: '0', software: '0', other: '3000.00', subcontractFixed: '0' },
      demand: [demand('study', { hours: 120, resourceId: 'R1' })] })],
  });
  const result = computePortfolio(snap, 'EXPECTED');
  const a = result.assignments[0];
  it('calculates direct cost and contribution', () => {
    expect(a.revenue).toBe('25000.00');
    expect(a.internalCost).toBe('9600.00');
    expect(a.directCost).toBe('12600.00');
    expect(a.contribution).toBe('12400.00');
    expect(a.marginPct).toBe(49.6);
  });
  it('consumes 120 resource hours, phased by working days (60 in January, 60 in February)', () => {
    const r1 = result.capacity.resources[0];
    expect(r1.totals.planned).toBe(120);
    expect(result.pnl.find((p) => p.key === '2026-01')?.internalApplied).toBe('4800.00');
    expect(result.pnl.find((p) => p.key === '2026-02')?.revenue).toBe('12500.00');
  });
  it('forecasts the receipt 30 days after completion invoicing, not at invoice date', () => {
    expect(result.cash.months.find((m) => m.key === '2026-02')?.receipts).toBe('0.00');
    expect(result.cash.months.find((m) => m.key === '2026-03')?.receipts).toBe('25000.00');
  });
});

describe('Case B — EPCM industrial expansion with several services', () => {
  const services = [
    assignment('PM', { serviceId: 'pm', serviceName: 'Project management', start: '2026-01-05', end: '2026-12-18', fixedFee: '120000.00', demand: [demand('pm', { hours: 600, resourceId: 'RPM' })] }),
    assignment('ENG', { serviceId: 'eng', serviceName: 'Engineering coordination', feeModel: 'TIME_AND_MATERIALS', hourlyRate: '110.00', billing: 'MONTHLY', start: '2026-02-02', end: '2026-07-31',
      demand: [demand('eng', { hours: 800, sourcing: 'EXTERNAL', externalRate: '85.00' })] }),
    assignment('PROC', { serviceId: 'proc', serviceName: 'Procurement', feeModel: 'MILESTONE', billing: 'MILESTONE', start: '2026-03-02', end: '2026-08-28',
      milestones: [{ id: 'm1', title: 'Tender', date: '2026-05-29', amount: '46000.00', invoiced: false }, { id: 'm2', title: 'Award', date: '2026-08-28', amount: '46000.00', invoiced: false }],
      demand: [demand('proc', { hours: 400, resourceId: 'RPR' })] }),
    assignment('CM', { serviceId: 'cm', serviceName: 'Construction management', feeModel: 'RETAINER', monthlyRetainer: '10000.00', billing: 'MONTHLY', start: '2026-03-01', end: '2026-12-31',
      expenses: { travel: '5000.00', software: '0', other: '0', subcontractFixed: '0' }, demand: [demand('cm', { hours: 1000, resourceId: 'RCM' })] }),
  ];
  const result = computePortfolio(snapshot({ resources: [resource('RPM', { costRate: '90.00' }), resource('RPR'), resource('RCM', { costRate: '75.00' })], assignments: services }), 'EXPECTED');
  it('calculates each service margin', () => {
    const by = Object.fromEntries(result.assignments.map((a) => [a.id, a]));
    expect([by.PM.contribution, by.ENG.revenue, by.ENG.contribution, by.PROC.contribution, by.CM.revenue, by.CM.contribution])
      .toEqual(['66000.00', '88000.00', '20000.00', '60000.00', '100000.00', '20000.00']);
  });
  it('reconciles the project total with the service totals', () => {
    const revenue = result.byService.reduce((s, x) => s + Number(x.revenue), 0);
    const contribution = result.byService.reduce((s, x) => s + Number(x.contribution), 0);
    expect(revenue).toBe(400000);
    expect(contribution).toBe(166000);
    expect(result.byClient[0].marginPct).toBe(41.5);
    expect(result.totals.revenue).toBe('400000.00'); // whole project falls inside the horizon
  });
});

describe('Case C — capacity bottleneck on a scarce senior project manager', () => {
  const skills = [{ id: 'pm', name: 'Project management', parentId: null }];
  const pm = resource('SPM', { skills: [{ skillId: 'pm', level: 4 }] });
  const base = (named: boolean) => snapshot({ horizonEnd: '2026-01-30', skills, resources: [pm], assignments: [
    assignment('X', { start: '2026-01-05', end: '2026-01-30', fixedFee: '1', demand: [demand('x', { hours: 120, resourceId: 'SPM' })] }),
    assignment('Y', { start: '2026-01-05', end: '2026-01-30', fixedFee: '1', demand: [demand('y', { hours: 120, skillId: 'pm', seniority: 'SENIOR', resourceId: named ? 'SPM' : null })] }),
  ] });
  it('detects the over-allocation of a named resource', () => {
    const result = computePortfolio(base(true), 'EXPECTED');
    expect(result.capacity.resources[0].totals).toMatchObject({ available: 160, planned: 240, utilization: 1.5 });
    expect(result.capacity.bottlenecks).toEqual([expect.objectContaining({ kind: 'RESOURCE_OVERLOAD', id: 'SPM', periodKey: '2026-01', excessHours: 80 })]);
  });
  it('allocates skill-based demand to free qualified capacity and reports the missing hours', () => {
    const result = computePortfolio(base(false), 'EXPECTED');
    expect(result.capacity.skills[0]).toMatchObject({ skillId: 'pm', totalShortage: 80 });
    expect(result.assignments.find((a) => a.id === 'Y')).toMatchObject({ internalHours: 40, shortageHours: 80, shortageCost: '9200.00' });
  });
  it('shows a feasible alternative when a qualified freelancer is added', () => {
    const snap = base(false);
    snap.resources.push(resource('FL', { internal: false, kind: 'FREELANCER', costRate: '100.00', skills: [{ skillId: 'pm', level: 3 }] }));
    const result = computePortfolio(snap, 'EXPECTED');
    expect(result.capacity.bottlenecks).toEqual([]);
    expect(result.assignments.find((a) => a.id === 'Y')).toMatchObject({ internalHours: 40, externalHours: 80, externalCost: '8000.00' });
  });
  it('ignores under-qualified resources', () => {
    const snap = base(false);
    snap.resources.push(resource('JR', { skills: [{ skillId: 'pm', level: 1 }] }));
    expect(computePortfolio(snap, 'EXPECTED').capacity.skills[0].totalShortage).toBe(80);
  });
});

describe('Case E — cash-flow stress with a delayed milestone payment', () => {
  const snap = snapshot({ asOf: '2026-01-01', openingCash: '10000.00', resources: [resource('R', { monthlyFixedCost: '10000.00' })],
    assignments: [assignment('P', { start: '2026-01-01', end: '2026-06-30', fixedFee: '90000.00', paymentTermDays: 60, demand: [demand('w', { hours: 500, resourceId: 'R' })] })] });
  const result = computePortfolio(snap, 'EXPECTED');
  it('keeps the project profitable but forecasts a negative cash balance', () => {
    expect(Number(result.assignments[0].contribution)).toBeGreaterThan(0);
    expect(result.cash.minBalance).toBe('-60000.00');
    expect(result.cash.minBalanceDate).toBe('2026-07-31');
    expect(result.cash.peakDeficit).toBe('70000.00');
    expect(result.cash.financingRequirement).toBe('60000.00');
  });
  it('reconciles the closing balance', () => {
    expect(result.cash.endBalance).toBe('-20000.00'); // 10,000 + 90,000 − 12 × 10,000
    expect(result.cash.months.at(-1)?.closing).toBe('-20000.00');
  });
  it('shows the project-level peak financing need and time to positive cash', () => {
    expect(result.assignments[0].cash.peakFinancingNeed).toBe('40000.00'); // 500 h × 80 €/h internal labor before receipt
    expect(result.assignments[0].cash.timeToPositive).toBe('2026-08-29');
  });
});

describe('Case F — opportunity portfolio', () => {
  const snap = snapshot({ assignments: [
    assignment('C', { fixedFee: '80000.00' }),
    assignment('O1', { commitment: 'PIPELINE', probability: 0.3, contractId: null, opportunityId: 'o1', fixedFee: '100000.00' }),
    assignment('O2', { commitment: 'PIPELINE', probability: 0.6, contractId: null, opportunityId: 'o2', fixedFee: '50000.00' }),
  ] });
  it('separates backlog, unweighted and weighted pipeline', () => {
    const r = computePortfolio(snap, 'EXPECTED');
    expect([r.totals.backlog, r.totals.pipelineUnweighted, r.totals.pipelineWeighted]).toEqual(['80000.00', '150000.00', '60000.00']);
  });
  it('produces contracted, expected and all-win scenarios', () => {
    expect(computePortfolio(snap, 'CONTRACTED').totals.revenue).toBe('80000.00');
    expect(computePortfolio(snap, 'EXPECTED').totals.revenue).toBe('140000.00');
    expect(computePortfolio(snap, 'ALL_WIN').totals.revenue).toBe('230000.00');
  });
});

describe('Case H — project underperformance', () => {
  const snap = snapshot({ resources: [resource('R')], assignments: [assignment('H', { fixedFee: '50000.00', start: '2026-01-05', end: '2026-03-27',
    baseline: { revenue: '50000.00', directCost: '24000.00', hours: 300, marginPct: 52 },
    actuals: { hours: 250, cost: '20000.00', revenue: '30000.00', invoicedNet: '30000.00', percentComplete: null },
    demand: [demand('eng', { hours: 300, actualHours: 250, remainingHours: 150, resourceId: 'R' })] })] });
  const a = computePortfolio(snap, 'EXPECTED').assignments[0];
  it('deteriorates the forecast at completion and flags the negative variance', () => {
    expect(a.hoursAtCompletion).toBe(400);
    expect(a.hoursVariance).toBe(100);
    expect(a.costAtCompletion).toBe('32000.00');
    expect(a.contribution).toBe('18000.00');
    expect(a.marginPct).toBe(36);
    expect(a.marginVariancePts).toBe(-16);
    expect(a.remainingRevenue).toBe('20000.00');
  });
});

describe('edge cases', () => {
  it('handles zero revenue without dividing by zero', () => {
    const r = computePortfolio(snapshot({ assignments: [assignment('Z', { fixedFee: '0', demand: [demand('d', { hours: 10, sourcing: 'EXTERNAL', externalRate: '50' })] })] }), 'EXPECTED');
    expect(r.assignments[0].marginPct).toBeNull();
    expect(r.assignments[0].contribution).toBe('-500.00');
  });
  it('flags missing fee parameters instead of inventing revenue', () => {
    const r = computePortfolio(snapshot({ assignments: [assignment('M', { feeModel: 'TIME_AND_MATERIALS', demand: [demand('d', { hours: 10, sourcing: 'EXTERNAL' })] })] }), 'EXPECTED');
    expect(r.assignments[0].revenue).toBe('0.00');
    expect(r.assignments[0].warnings).toContain('MISSING_FEE_PARAMETER:hourlyRate');
  });
  it('applies effective-dated rate changes from their effective date', () => {
    const r = computePortfolio(snapshot({ resources: [resource('R', { rates: [{ effectiveFrom: '2020-01-01', costRate: '80.00', billRate: null, monthlyFixedCost: null }, { effectiveFrom: '2026-02-02', costRate: '100.00', billRate: null, monthlyFixedCost: null }] })],
      assignments: [assignment('A', { fixedFee: '1', demand: [demand('d', { hours: 120, resourceId: 'R' })] })] }), 'EXPECTED');
    expect(r.assignments[0].internalCost).toBe('10800.00'); // 60 h × 80 + 60 h × 100
  });
  it('separates VAT from economics and settles it with the configured lag', () => {
    const r = computePortfolio(snapshot({ config: testConfig({ vat: { enabled: true, ratePct: 19, paymentLagMonths: 1, paymentDay: 10 } }),
      assignments: [assignment('V', { fixedFee: '10000.00', end: '2026-01-30', paymentTermDays: 14 })] }), 'EXPECTED');
    expect(r.assignments[0].revenue).toBe('10000.00');
    // January invoice: gross receipt in February, January output VAT due on 10 February (advance return, 1-month lag)
    expect(r.cash.months.find((m) => m.key === '2026-02')).toMatchObject({ receipts: '11900.00', vat: '1900.00', net: '10000.00' });
    expect(r.cash.byCategory).toEqual(expect.arrayContaining([{ category: 'VAT', amount: '-1900.00' }]));
  });
  it('computes revenue for retainer, daily, CAPEX and hybrid models', () => {
    const r = computePortfolio(snapshot({ assignments: [
      assignment('RET', { feeModel: 'RETAINER', monthlyRetainer: '3100.00', start: '2026-01-16', end: '2026-02-28' }), // 16/31 + 1 months
      assignment('DAY', { feeModel: 'DAILY_RATE', dailyRate: '800.00', demand: [demand('d', { hours: 40, sourcing: 'EXTERNAL' })] }),
      assignment('CAP', { feeModel: 'CAPEX_PERCENT', capexBasis: '2000000.00', capexPercent: '3.5' }),
      assignment('HYB', { feeModel: 'HYBRID', fixedFee: '1000.00', hourlyRate: '100.00', demand: [demand('b', { hours: 5, sourcing: 'EXTERNAL' }), demand('n', { hours: 7, billable: false, sourcing: 'EXTERNAL' })],
        adjustments: [{ date: '2026-02-01', amount: '250.00' }] }),
    ] }), 'EXPECTED');
    expect(r.assignments.map((a) => a.revenue)).toEqual(['4700.00', '4000.00', '70000.00', '1750.00']);
  });
  it('treats approved absences and non-project time as unavailable capacity', () => {
    const r = computePortfolio(snapshot({ resources: [resource('R', { nonProjectPct: 25, absences: [{ start: '2026-01-05', end: '2026-01-09', fraction: 1 }] })] }), 'EXPECTED');
    expect(r.capacity.resources[0].weeks[0]).toMatchObject({ available: 0 });
    expect(r.capacity.resources[0].weeks[1]).toMatchObject({ available: 30 });
  });
});
