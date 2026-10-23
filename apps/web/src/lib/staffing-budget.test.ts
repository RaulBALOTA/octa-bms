import { describe, expect, it } from 'vitest';
import { shiftStaffingDate, staffingBudgetCsv } from './staffing-budget';
import type { StaffingBudgetResult } from '../../../../packages/shared/src/staffing-budget';

describe('staffing budget exports and dates', () => {
  it('shifts hiring dates without losing leap-day inputs', () => {
    expect(shiftStaffingDate('2028-02-29', 1)).toBe('2029-02-28');
    expect(shiftStaffingDate('2026-04-15', 1)).toBe('2027-04-15');
    expect(shiftStaffingDate(null, 1)).toBeNull();
  });
  it('exports exact amounts and protects spreadsheet labels from formula execution', () => {
    const month = { month: '2026-01', budget: '100.00', forecast: '50.00', variance: '-50.00', budgetFte: '1.0000', forecastFte: '0.5000' };
    const result: StaffingBudgetResult = { year: 2026, currency: 'EUR', fiscalYearStart: 1, months: [month], departments: [], offices: [],
      totals: month, rows: [{ positionId: 'role', name: '=HYPERLINK("test")', code: 'CODE', status: 'OPEN', department: null, office: null,
        headcount: 1, fte: 1, annualSalary: '1200', annualBonus: '0', monthlyBenefits: '0', employerCostPct: 0, recruitingCost: '0',
        plannedStart: '2026-01-01', forecastStart: '2026-01-01', hiringProbability: 50, months: [month], totals: month }] };
    const csv = staffingBudgetCsv(result);
    expect(csv).toContain('"\'=HYPERLINK(""test"")"');
    expect(csv).toContain('"100.00","50.00","-50.00"');
    expect(csv).toContain('"TOTAL"');
  });
});
