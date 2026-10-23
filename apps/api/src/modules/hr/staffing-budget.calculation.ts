import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StaffingBudgetLineInput, StaffingBudgetMonth, StaffingBudgetResult, StaffingBudgetRow, StaffingBudgetTotals } from '../../../../../packages/shared/src/staffing-budget';

type SourceRow = StaffingBudgetLineInput & Pick<StaffingBudgetRow, 'name' | 'code' | 'status' | 'department' | 'office'>;
const D = Prisma.Decimal;
const cents = (amount: Prisma.Decimal) => amount.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const day = 86_400_000;
function date(value: string) {
  const result = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid staffing date');
  return result;
}
function totals(months: StaffingBudgetTotals[]): StaffingBudgetTotals {
  const budget = months.reduce((sum, month) => sum.plus(month.budget), new D(0));
  const forecast = months.reduce((sum, month) => sum.plus(month.forecast), new D(0));
  return { budget: cents(budget), forecast: cents(forecast), variance: cents(forecast.minus(budget)) };
}

export function calculateStaffingBudget(year: number, fiscalYearStart: number, currency: string, source: SourceRow[]): StaffingBudgetResult {
  if (!Number.isInteger(fiscalYearStart) || fiscalYearStart < 1 || fiscalYearStart > 12) throw new BadRequestException('Invalid company fiscal year start');
  const starts = Array.from({ length: 12 }, (_, index) => Date.UTC(year, fiscalYearStart - 1 + index, 1));
  const rows: StaffingBudgetRow[] = source.map((line) => {
    const planned = date(line.plannedStart);
    const expected = date(line.forecastStart);
    const until = line.endDate ? date(line.endDate) + day : Infinity;
    if (until <= planned || until <= expected) throw new BadRequestException('End date must not precede either start date');
    const headcountFte = new D(line.headcount).times(line.fte);
    const probability = new D(line.hiringProbability).div(100);
    const recurring = (salary: string) => new D(salary).plus(line.annualBonus).div(12)
      .times(new D(1).plus(new D(line.employerCostPct).div(100))).plus(line.monthlyBenefits).times(headcountFte);
    const monthlyBudget = recurring(line.annualSalary);
    const monthlyForecast = recurring(line.forecastAnnualSalary ?? line.annualSalary);
    const hireCost = new D(line.recruitingCost).times(line.headcount);
    const months: StaffingBudgetMonth[] = starts.map((start) => {
      const end = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 1);
      const fraction = (begin: number) => new D(Math.max(0, Math.min(until, end) - Math.max(begin, start))).div(end - start);
      const budgetFactor = fraction(planned);
      const forecastFactor = fraction(expected);
      const budget = new D(cents(monthlyBudget.times(budgetFactor).plus(planned >= start && planned < end && planned < until ? hireCost : 0)));
      const forecast = new D(cents(monthlyForecast.times(forecastFactor).plus(expected >= start && expected < end && expected < until ? hireCost : 0).times(probability)));
      return { month: new Date(start).toISOString().slice(0, 7), budget: cents(budget), forecast: cents(forecast), variance: cents(forecast.minus(budget)),
        budgetFte: headcountFte.times(budgetFactor).toFixed(4), forecastFte: headcountFte.times(forecastFactor).times(probability).toFixed(4) };
    });
    return { ...line, months, totals: totals(months) };
  });
  const months = starts.map((start, index) => {
    const values = rows.map((row) => row.months[index]);
    return { month: new Date(start).toISOString().slice(0, 7), ...totals(values),
      budgetFte: values.reduce((sum, row) => sum.plus(row.budgetFte), new D(0)).toFixed(4),
      forecastFte: values.reduce((sum, row) => sum.plus(row.forecastFte), new D(0)).toFixed(4) };
  });
  const groups = (key: 'department' | 'office') => {
    const byId = new Map<string | null, { id: string | null; name: string | null; values: StaffingBudgetTotals[] }>();
    for (const row of rows) {
      const entity = row[key];
      const group = byId.get(entity?.id ?? null) ?? { id: entity?.id ?? null, name: entity?.name ?? null, values: [] };
      group.values.push(row.totals); byId.set(group.id, group);
    }
    return [...byId.values()].map(({ values, ...group }) => ({ ...group, ...totals(values) }));
  };
  return { year, fiscalYearStart, currency, rows, months, departments: groups('department'), offices: groups('office'), totals: totals(months) };
}
