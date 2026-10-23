import type { AttractivenessDimension, EngineConfig, OptimizationObjective, Seniority } from '../../../../../../packages/shared/src/business-engine';
import { EngineInputError } from './calendar';

export const ENGINE_VERSION = '1.0.0';

/**
 * ILLUSTRATIVE defaults. They let the engine run on a fresh installation but are NOT company facts:
 * `illustrative: true` is shown in every result until management confirms the settings.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  illustrative: true,
  currency: 'EUR',
  horizonMonths: 18,
  calendar: { holidayRegion: 'DE_NATIONAL', extraHolidays: [], hoursPerDay: 8 },
  capacity: { defaultNonProjectPct: 15, defaultMaxAllocationPct: 90 },
  rates: {
    defaultInternalCostRate: '70.00', defaultExternalRate: '95.00', shortageCostRate: '115.00',
    seniorityCostFactors: { JUNIOR: 0.75, PROFESSIONAL: 1, SENIOR: 1.25, LEAD: 1.45, PRINCIPAL: 1.7 },
  },
  // Same defaults as Sales (opportunities.service.ts) so the two modules never disagree.
  stageProbabilities: { LEAD: 10, QUALIFIED: 25, GO_NO_GO: 40, PROPOSAL: 60, NEGOTIATION: 75, WON: 100, LOST: 0, CANCELLED: 0 },
  probabilitySource: 'OPPORTUNITY',
  overhead: { monthly: [], allocation: { method: 'NONE', value: '0' } },
  cash: {
    openingCashSource: 'BANK', manualOpeningCash: '0.00', minCashReserve: '0.00', financingLimit: '0.00',
    defaultPaymentTermDays: 30, supplierPaymentTermDays: 30, overdueCollectionDays: 14, collectionDelayDays: 0,
  },
  vat: { enabled: true, ratePct: 19, paymentLagMonths: 1, paymentDay: 10 },
  hiring: { employerCostPct: 21, onboardingWeeks: 12, nonBillablePct: 20, recruitingCost: '0.00', annualProductiveWeeks: 46 },
  scoring: {
    weights: {
      historicalMargin: 3, forecastMargin: 2, cash: 1, capacityEfficiency: 2, demand: 2, winRate: 1, repeatability: 1, scalability: 1,
      crossSelling: 1, strategicImportance: 2, referenceValue: 1, commercialRisk: 1, technicalRisk: 1,
    },
    priorStrength: 3,
  },
  benchmarks: { minSamples: 5, recalibrationThresholdPct: 10 },
  alerts: {
    hoursOverrunPct: 10, marginErosionPts: 5, unfilledWeeksAhead: 6, unfilledHoursThreshold: 8, overloadPct: 10, overdueDays: 30,
    concentrationPct: 35, seniorSharePct: 40, rateIncreasePct: 5, recipientUserIds: [],
  },
  optimization: { objectiveWeights: { CONTRIBUTION: 1 }, timeLimitSeconds: 10, allowExternalSourcing: true, cashConstraint: true, basis: 'IF_WON', externalMarkupPct: 0 },
  monteCarlo: {
    defaultIterations: 200, maxIterations: 2000, correlation: 0.3,
    startDelayDays: { min: 0, mode: 14, max: 90 }, effortFactor: { min: 0.9, mode: 1.05, max: 1.35 }, collectionDelayDays: { min: 0, mode: 7, max: 45 },
  },
};

const DIMENSIONS = Object.keys(DEFAULT_ENGINE_CONFIG.scoring.weights) as AttractivenessDimension[];
const OBJECTIVES: OptimizationObjective[] = ['CONTRIBUTION', 'OPERATING_PROFIT', 'CASH', 'PEAK_WORKING_CAPITAL', 'RISK_ADJUSTED_VALUE', 'STRATEGIC'];
const SENIORITIES: Seniority[] = ['JUNIOR', 'PROFESSIONAL', 'SENIOR', 'LEAD', 'PRINCIPAL'];
const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;

type Path = string;
function fail(path: Path, message: string): never { throw new EngineInputError('INVALID_CONFIG', `${path}: ${message}`); }
function num(value: unknown, path: Path, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `expected ${integer ? 'integer' : 'number'} in [${min}, ${max}]`);
  return value;
}
function moneyStr(value: unknown, path: Path, allowNegative = false): string {
  if (typeof value !== 'string' || !MONEY.test(value) || (!allowNegative && value.startsWith('-'))) fail(path, 'expected decimal amount string');
  return value;
}
function oneOf<T extends string>(value: unknown, path: Path, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, `expected one of ${values.join(', ')}`);
  return value as T;
}
const bool = (value: unknown, path: Path) => { if (typeof value !== 'boolean') fail(path, 'expected boolean'); return value; };
const obj = (value: unknown, path: Path): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object');
  return value as Record<string, unknown>;
};
function tri(value: unknown, path: Path, min: number, max: number) {
  const o = obj(value, path);
  const t = { min: num(o.min, `${path}.min`, min, max), mode: num(o.mode, `${path}.mode`, min, max), max: num(o.max, `${path}.max`, min, max) };
  if (!(t.min <= t.mode && t.mode <= t.max)) fail(path, 'requires min ≤ mode ≤ max');
  return t;
}

/** Deep-merge a partial input over defaults and validate every field. Unknown keys are rejected. */
export function resolveConfig(input: unknown, base: EngineConfig = DEFAULT_ENGINE_CONFIG): EngineConfig {
  const merged = deepMerge(base, input ?? {}) as Record<string, unknown>;
  const allowed = new Set(Object.keys(DEFAULT_ENGINE_CONFIG));
  for (const key of Object.keys(merged)) if (!allowed.has(key)) fail(key, 'unknown setting');
  const c = merged as unknown as EngineConfig;
  const holidays = c.calendar.extraHolidays;
  if (!Array.isArray(holidays) || holidays.some((d) => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d))) fail('calendar.extraHolidays', 'expected YYYY-MM-DD list');
  const stage = obj(c.stageProbabilities, 'stageProbabilities');
  for (const [key, value] of Object.entries(stage)) num(value, `stageProbabilities.${key}`, 0, 100);
  if (!Array.isArray(c.overhead.monthly)) fail('overhead.monthly', 'expected list');
  const weights = obj(c.scoring.weights, 'scoring.weights');
  for (const key of Object.keys(weights)) if (!DIMENSIONS.includes(key as AttractivenessDimension)) fail(`scoring.weights.${key}`, 'unknown dimension');
  const objectiveWeights = obj(c.optimization.objectiveWeights, 'optimization.objectiveWeights');
  for (const [key, value] of Object.entries(objectiveWeights)) { oneOf(key, 'optimization.objectiveWeights', OBJECTIVES); num(value, `optimization.objectiveWeights.${key}`, 0, 1000); }
  if (!Object.values(objectiveWeights).some((value) => (value as number) > 0)) fail('optimization.objectiveWeights', 'at least one objective needs a positive weight');
  const factors = obj(c.rates.seniorityCostFactors, 'rates.seniorityCostFactors');
  for (const level of SENIORITIES) num(factors[level], `rates.seniorityCostFactors.${level}`, 0.1, 10);
  const recipients = c.alerts.recipientUserIds;
  if (!Array.isArray(recipients) || recipients.some((id) => typeof id !== 'string')) fail('alerts.recipientUserIds', 'expected list of user ids');
  return {
    illustrative: bool(c.illustrative, 'illustrative'),
    currency: oneOf(c.currency, 'currency', ['EUR', 'CHF', 'GBP', 'USD', 'PLN', 'CZK', 'DKK', 'SEK'] as const),
    horizonMonths: num(c.horizonMonths, 'horizonMonths', 3, 60, true),
    calendar: { holidayRegion: oneOf(c.calendar.holidayRegion, 'calendar.holidayRegion', ['DE_NATIONAL', 'NONE'] as const), extraHolidays: holidays,
      hoursPerDay: num(c.calendar.hoursPerDay, 'calendar.hoursPerDay', 1, 24) },
    capacity: { defaultNonProjectPct: num(c.capacity.defaultNonProjectPct, 'capacity.defaultNonProjectPct', 0, 100),
      defaultMaxAllocationPct: num(c.capacity.defaultMaxAllocationPct, 'capacity.defaultMaxAllocationPct', 1, 150) },
    rates: { defaultInternalCostRate: moneyStr(c.rates.defaultInternalCostRate, 'rates.defaultInternalCostRate'),
      defaultExternalRate: moneyStr(c.rates.defaultExternalRate, 'rates.defaultExternalRate'), shortageCostRate: moneyStr(c.rates.shortageCostRate, 'rates.shortageCostRate'),
      seniorityCostFactors: Object.fromEntries(SENIORITIES.map((level) => [level, factors[level] as number])) as Record<Seniority, number> },
    stageProbabilities: stage as Record<string, number>,
    probabilitySource: oneOf(c.probabilitySource, 'probabilitySource', ['OPPORTUNITY', 'STAGE'] as const),
    overhead: {
      monthly: c.overhead.monthly.map((line, index) => {
        const o = obj(line, `overhead.monthly[${index}]`);
        if (typeof o.category !== 'string' || !o.category.trim() || o.category.length > 60) fail(`overhead.monthly[${index}].category`, 'required (≤ 60 chars)');
        return { category: o.category.trim(), amount: moneyStr(o.amount, `overhead.monthly[${index}].amount`) };
      }),
      allocation: { method: oneOf(c.overhead.allocation.method, 'overhead.allocation.method', ['NONE', 'PERCENT_OF_REVENUE', 'RATE_PER_INTERNAL_HOUR', 'PERCENT_OF_DIRECT_COST'] as const),
        value: moneyStr(c.overhead.allocation.value, 'overhead.allocation.value') },
    },
    cash: {
      openingCashSource: oneOf(c.cash.openingCashSource, 'cash.openingCashSource', ['BANK', 'MANUAL'] as const),
      manualOpeningCash: moneyStr(c.cash.manualOpeningCash, 'cash.manualOpeningCash', true), minCashReserve: moneyStr(c.cash.minCashReserve, 'cash.minCashReserve'),
      financingLimit: moneyStr(c.cash.financingLimit, 'cash.financingLimit'),
      defaultPaymentTermDays: num(c.cash.defaultPaymentTermDays, 'cash.defaultPaymentTermDays', 0, 365, true),
      supplierPaymentTermDays: num(c.cash.supplierPaymentTermDays, 'cash.supplierPaymentTermDays', 0, 365, true),
      overdueCollectionDays: num(c.cash.overdueCollectionDays, 'cash.overdueCollectionDays', 0, 365, true),
      collectionDelayDays: num(c.cash.collectionDelayDays, 'cash.collectionDelayDays', 0, 365, true),
    },
    vat: { enabled: bool(c.vat.enabled, 'vat.enabled'), ratePct: num(c.vat.ratePct, 'vat.ratePct', 0, 50),
      paymentLagMonths: num(c.vat.paymentLagMonths, 'vat.paymentLagMonths', 0, 3, true), paymentDay: num(c.vat.paymentDay, 'vat.paymentDay', 1, 28, true) },
    hiring: { employerCostPct: num(c.hiring.employerCostPct, 'hiring.employerCostPct', 0, 100), onboardingWeeks: num(c.hiring.onboardingWeeks, 'hiring.onboardingWeeks', 0, 104, true),
      nonBillablePct: num(c.hiring.nonBillablePct, 'hiring.nonBillablePct', 0, 100), recruitingCost: moneyStr(c.hiring.recruitingCost, 'hiring.recruitingCost'),
      annualProductiveWeeks: num(c.hiring.annualProductiveWeeks, 'hiring.annualProductiveWeeks', 20, 52) },
    scoring: { weights: Object.fromEntries(DIMENSIONS.map((key) => [key, num(weights[key] ?? 0, `scoring.weights.${key}`, 0, 100)])) as Record<AttractivenessDimension, number>,
      priorStrength: num(c.scoring.priorStrength, 'scoring.priorStrength', 0, 100) },
    benchmarks: { minSamples: num(c.benchmarks.minSamples, 'benchmarks.minSamples', 2, 1000, true),
      recalibrationThresholdPct: num(c.benchmarks.recalibrationThresholdPct, 'benchmarks.recalibrationThresholdPct', 0, 100) },
    alerts: {
      hoursOverrunPct: num(c.alerts.hoursOverrunPct, 'alerts.hoursOverrunPct', 0, 500), marginErosionPts: num(c.alerts.marginErosionPts, 'alerts.marginErosionPts', 0, 100),
      unfilledWeeksAhead: num(c.alerts.unfilledWeeksAhead, 'alerts.unfilledWeeksAhead', 1, 52, true), unfilledHoursThreshold: num(c.alerts.unfilledHoursThreshold, 'alerts.unfilledHoursThreshold', 0, 10000),
      overloadPct: num(c.alerts.overloadPct, 'alerts.overloadPct', 0, 500), overdueDays: num(c.alerts.overdueDays, 'alerts.overdueDays', 0, 365, true),
      concentrationPct: num(c.alerts.concentrationPct, 'alerts.concentrationPct', 0, 100), seniorSharePct: num(c.alerts.seniorSharePct, 'alerts.seniorSharePct', 0, 100),
      rateIncreasePct: num(c.alerts.rateIncreasePct, 'alerts.rateIncreasePct', 0, 500), recipientUserIds: recipients,
    },
    optimization: {
      objectiveWeights: objectiveWeights as EngineConfig['optimization']['objectiveWeights'],
      timeLimitSeconds: num(c.optimization.timeLimitSeconds, 'optimization.timeLimitSeconds', 1, 120),
      allowExternalSourcing: bool(c.optimization.allowExternalSourcing, 'optimization.allowExternalSourcing'),
      cashConstraint: bool(c.optimization.cashConstraint, 'optimization.cashConstraint'), basis: oneOf(c.optimization.basis, 'optimization.basis', ['IF_WON', 'EXPECTED'] as const),
      externalMarkupPct: num(c.optimization.externalMarkupPct, 'optimization.externalMarkupPct', 0, 200),
    },
    monteCarlo: {
      defaultIterations: num(c.monteCarlo.defaultIterations, 'monteCarlo.defaultIterations', 10, 10000, true), maxIterations: num(c.monteCarlo.maxIterations, 'monteCarlo.maxIterations', 10, 10000, true),
      correlation: num(c.monteCarlo.correlation, 'monteCarlo.correlation', 0, 0.99),
      startDelayDays: tri(c.monteCarlo.startDelayDays, 'monteCarlo.startDelayDays', -365, 730), effortFactor: tri(c.monteCarlo.effortFactor, 'monteCarlo.effortFactor', 0.1, 5),
      collectionDelayDays: tri(c.monteCarlo.collectionDelayDays, 'monteCarlo.collectionDelayDays', 0, 365),
    },
  };
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!base || typeof base !== 'object' || Array.isArray(base) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // Maps replace wholesale (probabilities, weights) so removed keys disappear.
    result[key] = ['stageProbabilities', 'objectiveWeights'].includes(key) ? value : deepMerge(result[key], value);
  }
  return result;
}
