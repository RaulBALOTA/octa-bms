import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calculateStaffingBudget } from './staffing-budget.calculation';

const row = (values: Partial<Parameters<typeof calculateStaffingBudget>[3][number]> = {}) => ({
  positionId: 'role', name: 'Developer', code: 'DEV', status: 'OPEN' as const,
  department: { id: 'department', name: 'Engineering' }, office: { id: 'office', name: 'Berlin' },
  headcount: 1, fte: 1, annualSalary: '60000', annualBonus: '0', monthlyBenefits: '0', employerCostPct: 0,
  recruitingCost: '0', plannedStart: '2026-01-01', forecastStart: '2026-01-01', hiringProbability: 100, ...values,
});

describe('staffing budget calculations', () => {
  it('calculates full-year costs, FTE, hiring fees and probability-weighted delayed forecasts', () => {
    const result = calculateStaffingBudget(2026, 1, 'EUR', [row({ headcount: 2, fte: 0.5, annualBonus: '12000',
      monthlyBenefits: '100', employerCostPct: 20, recruitingCost: '3000', forecastAnnualSalary: '72000', forecastStart: '2026-04-01', hiringProbability: 50 })]);
    expect(result.totals).toEqual({ budget: '93600.00', forecast: '41250.00', variance: '-52350.00' });
    expect(result.months[0]).toMatchObject({ budget: '13300.00', forecast: '0.00', budgetFte: '1.0000', forecastFte: '0.0000' });
    expect(result.months[3]).toMatchObject({ budget: '7300.00', forecast: '7250.00', forecastFte: '0.5000' });
    expect(result.departments[0].budget).toBe('93600.00');
    expect(result.offices[0].forecast).toBe('41250.00');
  });
  it('prorates actual calendar days, including leap February and an inclusive end date', () => {
    const result = calculateStaffingBudget(2028, 1, 'EUR', [row({ annualSalary: '348000', plannedStart: '2028-02-15', forecastStart: '2028-02-15', endDate: '2028-03-10' })]);
    expect(result.months[0].budget).toBe('0.00');
    expect(result.months[1].budget).toBe('15000.00');
    expect(result.months[2].budget).toBe('9354.84');
    expect(result.months[3].budget).toBe('0.00');
    expect(result.totals.budget).toBe('24354.84');
  });
  it('uses a non-January fiscal year and excludes out-of-period hiring fees', () => {
    const result = calculateStaffingBudget(2026, 5, 'GBP', [row({ plannedStart: '2026-01-01', forecastStart: '2027-01-01', recruitingCost: '1200' })]);
    expect(result.months[0].month).toBe('2026-05');
    expect(result.months[11].month).toBe('2027-04');
    expect(result.totals).toEqual({ budget: '60000.00', forecast: '21200.00', variance: '-38800.00' });
    expect(result.currency).toBe('GBP');
  });
  it('rounds each monthly amount to cents and reconciles every total', () => {
    const result = calculateStaffingBudget(2026, 1, 'EUR', [row({ annualSalary: '1.00' }), row({ positionId: 'other', annualSalary: '2.00', department: null, office: null })]);
    expect(result.rows[0].totals.budget).toBe('0.96');
    expect(result.rows[1].totals.budget).toBe('2.04');
    expect(result.months[0].budget).toBe('0.25');
    expect(result.totals.budget).toBe('3.00');
    expect(result.departments.map((group) => group.budget)).toEqual(['0.96', '2.04']);
  });
  it('handles zero-probability forecasts and dates beyond the horizon', () => {
    expect(calculateStaffingBudget(2026, 1, 'EUR', [row({ hiringProbability: 0 })]).totals.forecast).toBe('0.00');
    expect(calculateStaffingBudget(2026, 1, 'EUR', [row({ plannedStart: '2027-01-01', forecastStart: '2027-01-01' })]).totals.budget).toBe('0.00');
  });
  it('rejects invalid dates and an end date before the forecast start', () => {
    expect(() => calculateStaffingBudget(2026, 1, 'EUR', [row({ plannedStart: '2026-02-30' })])).toThrow(BadRequestException);
    expect(() => calculateStaffingBudget(2026, 1, 'EUR', [row({ endDate: '2026-06-01', forecastStart: '2026-07-01' })])).toThrow(BadRequestException);
  });
});
