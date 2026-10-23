import highsLoader from 'highs';
import { describe, expect, it } from 'vitest';
import { optimize } from './optimizer';
import { assignment, demand, resource, snapshot, testConfig } from './fixtures';

const load = () => highsLoader() as never;
const opp = (id: string, hours: number, fee: string, extra: Record<string, unknown> = {}) => assignment(id, {
  commitment: 'PIPELINE', probability: 0.5, contractId: null, opportunityId: id, start: '2026-01-05', end: '2026-01-30', fixedFee: fee,
  demand: [demand(`${id}-d`, { hours })], ...extra,
});
const base = (extra: Record<string, unknown> = {}) => snapshot({ horizonEnd: '2026-01-31', config: testConfig({ optimization: { allowExternalSourcing: false, cashConstraint: false } }),
  resources: [resource('R', { costRate: '70.00' })], assignments: [opp('P1', 100, '20000.00'), opp('P2', 90, '15000.00'), opp('P3', 70, '14000.00')], ...extra });

describe('Case G — optimization under limited capacity', () => {
  it('chooses the feasible portfolio with the higher objective, not the greedy single best project', async () => {
    const r = await optimize({ snapshot: base() }, load);
    expect(r.status).toBe('OPTIMAL');
    expect(r.candidates.filter((c) => c.selected).map((c) => c.key).sort()).toEqual(['P2', 'P3']);
    expect(r.objectives.CONTRIBUTION).toBe(17800); // (15,000 − 90 h × 70) + (14,000 − 70 h × 70) > 20,000 − 100 h × 70
    expect(r.gapPct).toBe(0);
    expect(r.verificationShortageHours).toBe(0);
    expect(r.binding.some((b) => b.kind === 'TOTAL_CAPACITY' || b.kind === 'CAPACITY')).toBe(true);
    expect(r.candidates.find((c) => c.key === 'P1')?.reasons.join(' ')).toMatch(/binding|higher objective/);
  });
  it('respects mutually exclusive alternatives', async () => {
    const snap = base(); snap.assignments[1].exclusiveGroup = 'site'; snap.assignments[2].exclusiveGroup = 'site';
    const r = await optimize({ snapshot: snap }, load);
    expect(r.candidates.filter((c) => c.selected).map((c) => c.key)).toEqual(['P1']);
  });
  it('never deselects contracted work and reports baseline overloads', async () => {
    const snap = base(); snap.assignments.push(assignment('C', { start: '2026-01-05', end: '2026-01-30', fixedFee: '1000.00', demand: [demand('c', { hours: 200, resourceId: 'R' })] }));
    const r = await optimize({ snapshot: snap }, load);
    expect(r.status).toBe('OPTIMAL');
    expect(r.candidates.every((c) => !c.selected)).toBe(true);
    expect(r.candidates.map((c) => c.key)).not.toContain('C');
    expect(r.baselineCapacityOverloads[0]).toMatchObject({ label: 'R', excessHours: 40 });
  });
  it('uses external sourcing when allowed and profitable', async () => {
    const r = await optimize({ snapshot: base(), allowExternalSourcing: true }, load);
    expect(r.candidates.filter((c) => c.selected).length).toBe(3);
    expect(r.candidates.some((c) => c.variant === 'EXTERNAL')).toBe(true);
  });
  it('reports infeasibility instead of a fake recommendation when a mandatory selection breaks capacity', async () => {
    const r = await optimize({ snapshot: base(), mandatoryOpportunityKeys: ['P1', 'P2'] }, load);
    expect(r.status).toBe('INFEASIBLE');
    expect(r.candidates).toEqual([]);
  });
  it('enforces the minimum cash constraint', async () => {
    const snap = base({ horizonEnd: '2026-03-31', config: testConfig({ optimization: { allowExternalSourcing: true, cashConstraint: true }, cash: { minCashReserve: '0.00', financingLimit: '0.00', supplierPaymentTermDays: 0 } }),
      resources: [resource('R', { costRate: '70.00', monthlyFixedCost: '0.00' })] });
    for (const a of snap.assignments) { a.billing = 'UPFRONT'; a.paymentTermDays = 60; } // external cost paid before the client pays
    const r = await optimize({ snapshot: snap }, load);
    expect(r.status).toBe('OPTIMAL');
    expect(r.candidates.filter((c) => c.variant === 'EXTERNAL')).toEqual([]); // external cost paid 31 Jan, client pays in March
    expect(r.candidates.filter((c) => c.selected).map((c) => c.key).sort()).toEqual(['P2', 'P3']);
  });
  it('can add a hire when it unlocks more value than it costs', async () => {
    const snap = base(); snap.horizonEnd = '2026-01-31';
    const r = await optimize({ snapshot: snap, hireOptions: [{ type: 'HIRE', name: 'Engineer', skillIds: [], weeklyHours: 40, start: '2026-01-05', monthlyFixedCost: '3000.00', costRate: '70.00', rampUpWeeks: 0 }] }, load);
    expect(r.status).toBe('OPTIMAL');
    expect(r.candidates.find((c) => c.kind === 'HIRE')?.selected).toBe(true);
    expect(r.candidates.filter((c) => c.kind === 'OPPORTUNITY' && c.selected).length).toBe(3);
  });
});
