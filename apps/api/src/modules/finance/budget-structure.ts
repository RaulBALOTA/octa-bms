/**
 * Kostenarten catalog for budget planning, structured after the German GuV
 * (§275 Abs. 2 HGB, Gesamtkostenverfahren) / DATEV-BWA cost groups. SKR04
 * ranges are indicative references for the tax-advisor mapping, not bookkeeping
 * rules. Category codes are stored on BudgetLine.category and
 * InvoiceLine.budgetCategory; the legacy aggregate code 'COST' (pre-structure
 * budgets) is still accepted and reported as an unallocated expense line.
 */

export type CategoryType = 'REVENUE' | 'EXPENSE';

export interface BudgetCategory {
  code: string;
  group: string;
  type: CategoryType;
  skr04: string;
  nameDe: string;
  nameEn: string;
}

export interface BudgetGroup {
  code: string;
  type: CategoryType;
  nameDe: string;
  nameEn: string;
}

export const BUDGET_GROUPS: BudgetGroup[] = [
  { code: 'ERLOESE', type: 'REVENUE', nameDe: 'Betriebserlöse', nameEn: 'Operating income' },
  { code: 'MATERIAL', type: 'EXPENSE', nameDe: 'Material / Fremdleistungen', nameEn: 'Materials / subcontracted services' },
  { code: 'PERSONAL', type: 'EXPENSE', nameDe: 'Personalaufwand', nameEn: 'Personnel expenses' },
  { code: 'ABSCHREIBUNGEN', type: 'EXPENSE', nameDe: 'Abschreibungen', nameEn: 'Depreciation' },
  { code: 'SONSTIGE', type: 'EXPENSE', nameDe: 'Sonstige betriebliche Aufwendungen', nameEn: 'Other operating expenses' },
  { code: 'FINANZ', type: 'EXPENSE', nameDe: 'Finanzergebnis / Steuern', nameEn: 'Financial result / taxes' },
];

export const BUDGET_CATEGORIES: BudgetCategory[] = [
  // Betriebserlöse
  { code: 'REVENUE', group: 'ERLOESE', type: 'REVENUE', skr04: '4000–4699', nameDe: 'Umsatzerlöse', nameEn: 'Revenue' },
  { code: 'OTHER_INCOME', group: 'ERLOESE', type: 'REVENUE', skr04: '4700–4999', nameDe: 'Sonstige betriebliche Erträge', nameEn: 'Other operating income' },
  // Materialaufwand / Fremdleistungen
  { code: 'SUBCONTRACT', group: 'MATERIAL', type: 'EXPENSE', skr04: '5900–5999', nameDe: 'Fremdleistungen', nameEn: 'Subcontracted services' },
  { code: 'MATERIALS', group: 'MATERIAL', type: 'EXPENSE', skr04: '5000–5899', nameDe: 'Material / Waren', nameEn: 'Materials / goods' },
  // Personalaufwand
  { code: 'WAGES', group: 'PERSONAL', type: 'EXPENSE', skr04: '6000–6099', nameDe: 'Löhne und Gehälter', nameEn: 'Wages and salaries' },
  { code: 'SOCIAL', group: 'PERSONAL', type: 'EXPENSE', skr04: '6100–6199', nameDe: 'Soziale Abgaben / Altersversorgung', nameEn: 'Social security / pensions' },
  // Abschreibungen
  { code: 'DEPRECIATION', group: 'ABSCHREIBUNGEN', type: 'EXPENSE', skr04: '6200–6299', nameDe: 'Abschreibungen (AfA)', nameEn: 'Depreciation' },
  // Sonstige betriebliche Aufwendungen
  { code: 'RENT', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6300–6399', nameDe: 'Raumkosten', nameEn: 'Premises costs' },
  { code: 'INSURANCE', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6400–6499', nameDe: 'Versicherungen / Beiträge', nameEn: 'Insurance / memberships' },
  { code: 'VEHICLES', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6500–6599', nameDe: 'Kfz-Kosten', nameEn: 'Vehicle costs' },
  { code: 'ADVERTISING', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6600–6649', nameDe: 'Werbekosten', nameEn: 'Advertising' },
  { code: 'TRAVEL', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6650–6699', nameDe: 'Reisekosten', nameEn: 'Travel expenses' },
  { code: 'IT_COMM', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6805–6837', nameDe: 'IT / Telekommunikation', nameEn: 'IT / telecommunications' },
  { code: 'LEGAL_CONSULT', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6825–6855', nameDe: 'Rechts- und Beratungskosten', nameEn: 'Legal and consulting fees' },
  { code: 'OFFICE', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6800–6899', nameDe: 'Büro- und Verwaltungskosten', nameEn: 'Office and administration' },
  { code: 'OTHER_OPEX', group: 'SONSTIGE', type: 'EXPENSE', skr04: '6900–6999', nameDe: 'Übrige betriebliche Aufwendungen', nameEn: 'Miscellaneous operating expenses' },
  // Finanzergebnis / Steuern
  { code: 'INTEREST', group: 'FINANZ', type: 'EXPENSE', skr04: '7300–7399', nameDe: 'Zinsen und ähnliche Aufwendungen', nameEn: 'Interest and similar expenses' },
  { code: 'TAXES', group: 'FINANZ', type: 'EXPENSE', skr04: '7600–7699', nameDe: 'Betriebliche Steuern', nameEn: 'Business taxes' },
];

/** legacy aggregate code from pre-structure budgets; reported under SONSTIGE */
export const LEGACY_COST = 'COST';

export const CATEGORY_CODES = BUDGET_CATEGORIES.map((c) => c.code);
export const VALID_PLAN_CATEGORIES = [...CATEGORY_CODES, LEGACY_COST];

const byCode = new Map(BUDGET_CATEGORIES.map((c) => [c.code, c]));

export function categoryType(code: string): CategoryType {
  return byCode.get(code)?.type ?? 'EXPENSE';
}

export function isRevenueCategory(code: string): boolean {
  return categoryType(code) === 'REVENUE';
}
