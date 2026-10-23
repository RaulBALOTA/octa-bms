export interface StaffingBudgetLineInput {
  positionId: string;
  officeId?: string | null;
  headcount: number;
  fte: number;
  annualSalary: string;
  forecastAnnualSalary?: string | null;
  annualBonus: string;
  monthlyBenefits: string;
  employerCostPct: number;
  recruitingCost: string;
  plannedStart: string;
  forecastStart: string;
  endDate?: string | null;
  hiringProbability: number;
}
export interface StaffingBudgetInput {
  title: string;
  year: number;
  includeOpen: boolean;
  includeBudgeted: boolean;
  lines: StaffingBudgetLineInput[];
  note?: string;
  expectedVersion?: number;
}
export interface StaffingBudgetMonth {
  month: string;
  budget: string;
  forecast: string;
  variance: string;
  budgetFte: string;
  forecastFte: string;
}
export interface StaffingBudgetTotals { budget: string; forecast: string; variance: string }
export interface StaffingBudgetRow extends StaffingBudgetLineInput {
  name: string;
  code: string;
  status: 'OPEN' | 'BUDGETED';
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  months: StaffingBudgetMonth[];
  totals: StaffingBudgetTotals;
}
export interface StaffingBudgetResult {
  year: number;
  currency: string;
  fiscalYearStart: number;
  rows: StaffingBudgetRow[];
  months: StaffingBudgetMonth[];
  departments: ({ id: string | null; name: string | null } & StaffingBudgetTotals)[];
  offices: ({ id: string | null; name: string | null } & StaffingBudgetTotals)[];
  totals: StaffingBudgetTotals;
}
export interface StaffingBudgetContext {
  company: { name: string; currency: string; fiscalYearStart: number };
  positions: { id: string; code: string; name: string; status: 'OPEN' | 'BUDGETED'; department: { id: string; name: string } | null }[];
  departments: { id: string; name: string; code: string }[];
  offices: { id: string; name: string; code: string; city: string | null }[];
}
export interface StaffingBudgetScenario {
  id: string;
  title: string;
  year: number;
  currency: string;
  fiscalYearStart: number;
  version: number;
  plan: StaffingBudgetInput;
  result: StaffingBudgetResult;
  updatedAt: string;
  revisions: { version: number; createdAt: string; note: string | null; createdBy: { firstName: string; lastName: string } }[];
}
