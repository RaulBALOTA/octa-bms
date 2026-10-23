import type { StaffingBudgetContext, StaffingBudgetInput, StaffingBudgetLineInput, StaffingBudgetResult } from '../../../../packages/shared/src/staffing-budget';

export function staffingDefaults(positionId: string, year: number, fiscalYearStart: number): StaffingBudgetLineInput {
  const start = `${year}-${String(fiscalYearStart).padStart(2, '0')}-01`;
  return { positionId, officeId: null, headcount: 1, fte: 1, annualSalary: '0', annualBonus: '0', monthlyBenefits: '0',
    employerCostPct: 0, recruitingCost: '0', plannedStart: start, forecastStart: start, hiringProbability: 100, endDate: null, forecastAnnualSalary: null };
}
export function newStaffingPlan(context: StaffingBudgetContext): StaffingBudgetInput {
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Berlin' }).format(now));
  const month = Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Europe/Berlin' }).format(now));
  const fiscalYear = month < context.company.fiscalYearStart ? year - 1 : year;
  return { title: '', year: fiscalYear, includeOpen: true, includeBudgeted: true,
    lines: context.positions.map((position) => staffingDefaults(position.id, fiscalYear, context.company.fiscalYearStart)) };
}
export function shiftStaffingDate(value: string | null | undefined, years: number): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
export function staffingBudgetCsv(result: StaffingBudgetResult): string {
  const cell = (value: string | number | null | undefined) => {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const records: (string | number | null | undefined)[][] = [[
    'Position', 'Code', 'Department', 'Office', 'Status', 'Currency', 'Month', 'Headcount', 'FTE per hire',
    'Budget', 'Forecast', 'Variance', 'Budget FTE', 'Forecast FTE', 'Annual salary', 'Forecast annual salary',
    'Annual bonus', 'Monthly benefits', 'Employer cost %', 'Hiring cost per hire', 'Planned start', 'Forecast start', 'End date', 'Hiring probability %',
  ]];
  for (const row of result.rows) for (const month of row.months) records.push([
    row.name, row.code, row.department?.name, row.office?.name, row.status, result.currency, month.month, row.headcount, row.fte,
    month.budget, month.forecast, month.variance, month.budgetFte, month.forecastFte, row.annualSalary, row.forecastAnnualSalary ?? row.annualSalary,
    row.annualBonus, row.monthlyBenefits, row.employerCostPct, row.recruitingCost, row.plannedStart, row.forecastStart, row.endDate, row.hiringProbability,
  ]);
  for (const month of result.months) records.push(['TOTAL', '', '', '', '', result.currency, month.month, '', '', month.budget, month.forecast, month.variance, month.budgetFte, month.forecastFte]);
  return `\uFEFF${records.map((record) => record.map(cell).join(',')).join('\r\n')}`;
}
