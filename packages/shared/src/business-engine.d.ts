/**
 * OCTA Business Engine — shared contracts (type-only).
 * Money is always a decimal string with explicit currency; hours are numbers.
 * Dates are ISO `YYYY-MM-DD` strings (UTC calendar dates).
 */

export type Money = string;
export type IsoDate = string;

export type FeeModel = 'FIXED_FEE' | 'TIME_AND_MATERIALS' | 'DAILY_RATE' | 'RETAINER' | 'MILESTONE' | 'CAPEX_PERCENT' | 'HYBRID';
export type BillingSchedule = 'MONTHLY' | 'MILESTONE' | 'UPFRONT' | 'ON_COMPLETION';
export type ServiceLifecycle = 'PROPOSED' | 'EXPERIMENTAL' | 'COMMERCIAL' | 'GROWING' | 'CORE' | 'UNDER_REVIEW' | 'RETIRED';
export type ResourceKind = 'EMPLOYEE' | 'MANAGEMENT' | 'PART_TIME' | 'FREELANCER' | 'CONSULTANT' | 'SUBCONTRACTOR' | 'PARTNER' | 'ENGINEERING_OFFICE' | 'AUTOMATION';
export type Seniority = 'JUNIOR' | 'PROFESSIONAL' | 'SENIOR' | 'LEAD' | 'PRINCIPAL';
export type Sourcing = 'INTERNAL' | 'EXTERNAL';
/** CONTRACTED: committed scope only · EXPECTED: pipeline weighted by probability · ALL_WIN: every opportunity won (overload analysis). */
export type PortfolioMode = 'CONTRACTED' | 'EXPECTED' | 'ALL_WIN';
export type CommitmentStatus = 'CONTRACTED' | 'PIPELINE' | 'COMPLETED';
export type DataBasis = 'ACTUAL' | 'CONTRACTED' | 'FORECAST' | 'WEIGHTED' | 'SIMULATED' | 'MISSING';

/* ------------------------------------------------------------------ configuration */

export interface Triangular { min: number; mode: number; max: number }

export interface EngineConfig {
  /** True while values are the shipped illustrative defaults and not confirmed by management. */
  illustrative: boolean;
  currency: string;
  horizonMonths: number;
  calendar: { holidayRegion: 'DE_NATIONAL' | 'NONE'; extraHolidays: IsoDate[]; hoursPerDay: number };
  capacity: { defaultNonProjectPct: number; defaultMaxAllocationPct: number };
  rates: { defaultInternalCostRate: Money; defaultExternalRate: Money; shortageCostRate: Money; seniorityCostFactors: Record<Seniority, number> };
  stageProbabilities: Record<string, number>;
  probabilitySource: 'OPPORTUNITY' | 'STAGE';
  overhead: {
    monthly: { category: string; amount: Money }[];
    allocation: { method: 'NONE' | 'PERCENT_OF_REVENUE' | 'RATE_PER_INTERNAL_HOUR' | 'PERCENT_OF_DIRECT_COST'; value: string };
  };
  cash: {
    openingCashSource: 'BANK' | 'MANUAL'; manualOpeningCash: Money; minCashReserve: Money; financingLimit: Money;
    defaultPaymentTermDays: number; supplierPaymentTermDays: number; overdueCollectionDays: number; collectionDelayDays: number;
  };
  vat: { enabled: boolean; ratePct: number; paymentLagMonths: number; paymentDay: number };
  hiring: { employerCostPct: number; onboardingWeeks: number; nonBillablePct: number; recruitingCost: Money; annualProductiveWeeks: number };
  scoring: { weights: Record<AttractivenessDimension, number>; priorStrength: number };
  benchmarks: { minSamples: number; recalibrationThresholdPct: number };
  alerts: {
    hoursOverrunPct: number; marginErosionPts: number; unfilledWeeksAhead: number; unfilledHoursThreshold: number;
    overloadPct: number; overdueDays: number; concentrationPct: number; seniorSharePct: number; rateIncreasePct: number; recipientUserIds: string[];
  };
  optimization: {
    objectiveWeights: Partial<Record<OptimizationObjective, number>>; timeLimitSeconds: number; allowExternalSourcing: boolean;
    cashConstraint: boolean; basis: 'IF_WON' | 'EXPECTED'; externalMarkupPct: number;
  };
  monteCarlo: { defaultIterations: number; maxIterations: number; correlation: number; startDelayDays: Triangular; effortFactor: Triangular; collectionDelayDays: Triangular };
}

/* ------------------------------------------------------------------ snapshot (engine input) */

export interface SnapshotRate { effectiveFrom: IsoDate; costRate: Money; billRate: Money | null; monthlyFixedCost: Money | null }
export interface SnapshotResource {
  id: string; name: string; kind: ResourceKind; internal: boolean; weeklyHours: number; maxAllocationPct: number; nonProjectPct: number;
  activeFrom: IsoDate | null; activeTo: IsoDate | null; skills: { skillId: string; level: number }[]; rates: SnapshotRate[];
  absences: { start: IsoDate; end: IsoDate; fraction: number }[]; rampUpWeeks?: number; simulated?: boolean;
}
export interface SnapshotDemand {
  id: string; skillId: string | null; skillName: string | null; role: string; seniority: Seniority; hours: number;
  start: IsoDate | null; end: IsoDate | null; resourceId: string | null; sourcing: Sourcing; billable: boolean;
  costRate: Money | null; externalRate: Money | null; actualHours: number; remainingHours: number | null;
}
export interface SnapshotAssignment {
  id: string; title: string; serviceId: string; serviceName: string; serviceCode: string; packageId: string | null;
  clientId: string; clientName: string; contractId: string | null; opportunityId: string | null; externalProjectRef: string | null;
  commitment: CommitmentStatus; probability: number; exclusiveGroup: string | null; shiftableWeeks: number;
  start: IsoDate; end: IsoDate; feeModel: FeeModel; billing: BillingSchedule; currency: string;
  fixedFee: Money | null; hourlyRate: Money | null; dailyRate: Money | null; hoursPerDay: number | null; monthlyRetainer: Money | null;
  capexBasis: Money | null; capexPercent: string | null; paymentTermDays: number; vatRatePct: number;
  expenses: { travel: Money; software: Money; other: Money; subcontractFixed: Money };
  milestones: { id: string; title: string; date: IsoDate; amount: Money; invoiced: boolean }[];
  adjustments: { date: IsoDate; amount: Money }[];
  demand: SnapshotDemand[];
  actuals: { hours: number; cost: Money; revenue: Money; invoicedNet: Money; percentComplete: number | null };
  baseline: { revenue: Money; directCost: Money; hours: number; marginPct: number | null } | null;
  targetMarginPct: number | null; externalDeliveryAllowed: boolean; responsibleUserId: string | null;
  strategicScore: number | null; riskScore: number | null; collectionDelayDays?: number;
}
export interface EngineSnapshot {
  asOf: IsoDate; horizonStart: IsoDate; horizonEnd: IsoDate; currency: string; config: EngineConfig;
  openingCash: Money; openingCashSource: 'BANK' | 'MANUAL';
  skills: { id: string; name: string; parentId: string | null }[];
  resources: SnapshotResource[]; assignments: SnapshotAssignment[];
  openReceivables: { id: string; clientId: string; amount: Money; dueDate: IsoDate }[];
  openPayables: { id: string; amount: Money; dueDate: IsoDate }[];
  /** Actual net revenue invoiced per month (finance ledger, outgoing non-draft/non-cancelled invoices). */
  actualInvoicedByMonth: { month: string; net: Money }[];
  /** Additional monthly fixed costs introduced by scenarios (e.g. hires are resources; this is for non-capacity costs). */
  extraFixedCosts?: { label: string; start: IsoDate; end: IsoDate | null; monthly: Money }[];
}

/* ------------------------------------------------------------------ results */

export interface Period { key: string; start: IsoDate; end: IsoDate }

export interface AssignmentEconomics {
  id: string; title: string; serviceId: string; serviceName: string; clientId: string; clientName: string; packageId: string | null;
  contractId: string | null; opportunityId: string | null; commitment: CommitmentStatus; probability: number; weight: number;
  start: IsoDate; end: IsoDate; feeModel: FeeModel;
  plannedRevenue: Money; revenue: Money; internalCost: Money; externalCost: Money; shortageCost: Money; expenses: Money; directCost: Money;
  contribution: Money; marginPct: number | null; allocatedOverhead: Money; operatingResult: Money;
  plannedHours: number; hoursAtCompletion: number; actualHours: number; remainingHours: number; internalHours: number; externalHours: number; shortageHours: number;
  actualCost: Money; costToComplete: Money; costAtCompletion: Money; plannedCost: Money; remainingRevenue: Money; invoicedNet: Money;
  baselineMarginPct: number | null; hoursVariance: number; marginVariancePts: number | null;
  contributionPerInternalHour: Money | null;
  cash: { peakFinancingNeed: Money; timeToPositive: IsoDate | null; outstandingReceivable: Money; netCash: Money };
  warnings: string[];
}

export interface Aggregate { key: string; name: string; revenue: Money; directCost: Money; contribution: Money; marginPct: number | null; hours: number; count: number }

export interface PnlPeriod extends Period {
  revenueContracted: Money; revenuePipeline: Money; revenue: Money; externalCost: Money; internalApplied: Money; contribution: Money;
  capacityCost: Money; unabsorbedCapacity: Money; overhead: Money; operatingResult: Money; actualInvoiced: Money | null;
}

export interface CashPeriod extends Period { receipts: Money; payments: Money; vat: Money; net: Money; closing: Money; basis: DataBasis }
export interface CashEvent { date: IsoDate; amount: Money; category: string; source: DataBasis; assignmentId?: string; label: string }

export interface CapacityCell { available: number; planned: number; utilization: number | null }
export interface ResourceCapacity {
  id: string; name: string; kind: ResourceKind; internal: boolean; simulated: boolean;
  totals: { nominal: number; absence: number; nonProject: number; available: number; planned: number; billable: number; utilization: number | null; billableUtilization: number | null };
  weeks: CapacityCell[];
}
export interface SkillCapacity { skillId: string | null; name: string; weeks: { demand: number; covered: number; shortage: number }[]; totalShortage: number }
export interface Bottleneck { kind: 'RESOURCE_OVERLOAD' | 'SKILL_SHORTAGE'; id: string | null; name: string; periodKey: string; excessHours: number; assignmentIds: string[] }

export interface PortfolioResult {
  engineVersion: string; asOf: IsoDate; mode: PortfolioMode; currency: string; calculatedAt: string; illustrativeConfig: boolean;
  months: Period[]; weeks: Period[];
  assignments: AssignmentEconomics[];
  byService: Aggregate[]; byClient: Aggregate[]; byPackage: Aggregate[];
  pnl: PnlPeriod[];
  totals: {
    backlog: Money; pipelineUnweighted: Money; pipelineWeighted: Money; revenue: Money; directCost: Money; contribution: Money; marginPct: number | null;
    capacityCost: Money; unabsorbedCapacity: Money; overhead: Money; operatingResult: Money;
    internalHours: number; availableHours: number; utilization: number | null; shortageHours: number; topClientSharePct: number | null;
  };
  capacity: { resources: ResourceCapacity[]; skills: SkillCapacity[]; bottlenecks: Bottleneck[] };
  cash: {
    opening: Money; openingSource: 'BANK' | 'MANUAL'; months: CashPeriod[]; weeks: CashPeriod[]; minBalance: Money; minBalanceDate: IsoDate;
    peakDeficit: Money; financingRequirement: Money; endBalance: Money; eventCount: number; byCategory: { category: string; amount: Money }[];
  };
  history: { month: string; invoicedNet: Money }[];
  warnings: { code: string; message: string; entityId?: string }[];
}

/* ------------------------------------------------------------------ scenarios */

export type ScenarioOperation =
  | { type: 'WIN'; assignmentIds?: string[]; opportunityId?: string }
  | { type: 'LOSE'; assignmentIds?: string[]; opportunityId?: string }
  | { type: 'SHIFT'; assignmentIds?: string[]; opportunityId?: string; days: number }
  | { type: 'STRETCH'; assignmentIds?: string[]; opportunityId?: string; pct: number }
  | { type: 'PRICE'; pct: number; serviceId?: string; assignmentIds?: string[]; includeContracted?: boolean }
  | { type: 'EFFORT'; pct: number; serviceId?: string; assignmentIds?: string[] }
  | { type: 'HIRE'; name: string; count?: number; skillIds: string[]; level?: number; weeklyHours: number; start: IsoDate; monthlyFixedCost: Money; costRate: Money; rampUpWeeks?: number }
  | { type: 'FREELANCER'; name: string; skillIds: string[]; level?: number; weeklyHours: number; start: IsoDate; end?: IsoDate | null; rate: Money }
  | { type: 'REMOVE_RESOURCE'; resourceId: string; from: IsoDate }
  | { type: 'OUTSOURCE'; rate: Money; serviceId?: string; assignmentIds?: string[]; skillId?: string }
  | { type: 'LABOR_COST'; pct: number; internal?: boolean; external?: boolean }
  | { type: 'OVERHEAD'; pct: number }
  | { type: 'PAYMENT_TERMS'; days: number; clientId?: string; assignmentIds?: string[] }
  | { type: 'PAYMENT_DELAY'; days: number; clientId?: string; assignmentIds?: string[] }
  | { type: 'STOP_SERVICE'; serviceId: string; from?: IsoDate }
  | { type: 'SCOPE'; pct: number; assignmentIds: string[] }
  | { type: 'PROBABILITY'; probabilityPct: number; assignmentIds?: string[]; opportunityId?: string }
  | { type: 'OPENING_CASH'; amount: Money }
  | { type: 'NEW_SERVICE'; assignment: Omit<SnapshotAssignment, 'id'> & { id?: string } };

export interface ScenarioMetrics {
  revenue: Money; contribution: Money; marginPct: number | null; operatingResult: Money; endCash: Money; minCash: Money; peakDeficit: Money;
  financingRequirement: Money; utilization: number | null; shortageHours: number; overloadCount: number; fixedCostCommitment: Money;
  topClientSharePct: number | null; unabsorbedCapacity: Money;
}

export interface ScenarioComparisonRow { key: keyof ScenarioMetrics; baseline: string | number | null; values: (string | number | null)[]; deltas: (string | number | null)[] }

export interface SensitivityResult {
  parameter: SensitivityParameter; steps: { pct: number; metrics: ScenarioMetrics }[];
  breakEven: { metric: 'operatingResult' | 'contribution' | 'minCash'; pct: number | null; note: string }[];
}
export type SensitivityParameter = 'PRICE' | 'HOURS' | 'INTERNAL_RATE' | 'EXTERNAL_RATE' | 'DURATION' | 'PROBABILITY' | 'PAYMENT_DELAY';

export interface DistributionSummary { mean: number; p5: number; p10: number; p50: number; p90: number; p95: number; min: number; max: number }
export interface MonteCarloResult {
  iterations: number; seed: number; correlation: number; labelling: 'SIMULATED';
  revenue: DistributionSummary; contribution: DistributionSummary; operatingResult: DistributionSummary; minCash: DistributionSummary; shortageHours: DistributionSummary;
  probabilityNegativeCash: number; probabilityBelowReserve: number; probabilityCapacityOverload: number; probabilityNegativeOperatingResult: number;
  assumptions: string[];
}

/* ------------------------------------------------------------------ optimization */

export type OptimizationObjective = 'CONTRIBUTION' | 'OPERATING_PROFIT' | 'CASH' | 'PEAK_WORKING_CAPITAL' | 'RISK_ADJUSTED_VALUE' | 'STRATEGIC';
export type SolverStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMED_OUT' | 'FAILED' | 'CANCELLED';

export interface OptimizationCandidateResult {
  key: string; kind: 'OPPORTUNITY' | 'HIRE'; title: string; opportunityId: string | null; assignmentIds: string[];
  selected: boolean; variant: string | null; mandatory: boolean; objectiveCoefficient: number;
  revenue: Money; contribution: Money; reducedCost: number | null; reasons: string[]; alternatives: { variant: string; objectiveCoefficient: number }[];
}
export interface BindingConstraint { name: string; label: string; kind: 'CAPACITY' | 'TOTAL_CAPACITY' | 'CASH' | 'EXCLUSIVE'; periodKey: string | null; shadowPrice: number | null; slack: number }

export interface OptimizationResult {
  status: SolverStatus; solverStatus: string; solver: string; runtimeMs: number; objectiveValue: number | null; bound: number | null; gapPct: number | null;
  objectives: Partial<Record<OptimizationObjective, number>>; candidates: OptimizationCandidateResult[]; binding: BindingConstraint[];
  baselineCapacityOverloads: { label: string; periodKey: string; excessHours: number }[];
  verification: ScenarioMetrics | null; verificationShortageHours: number | null;
  diagnostics: string[]; variables: number; constraints: number; approximations: string[];
}

/* ------------------------------------------------------------------ sourcing / scoring */

export interface SourcingOptionInput {
  kind: 'INTERNAL' | 'HIRE' | 'FREELANCE' | 'SUBCONTRACT' | 'PARTNER' | 'HYBRID'; label: string;
  hourlyCost?: Money; annualSalary?: Money; annualBenefits?: Money; weeklyHours?: number; fixedInvestment?: Money;
  capacityHours?: number | null; leadTimeWeeks?: number; coordinationOverheadPct?: number; minimumCommitmentHours?: number;
  riskScore?: number; qualityControlPct?: number; strategicScore?: number; dependencyRisk?: number; internalSharePct?: number;
}
export interface SourcingOptionResult {
  kind: SourcingOptionInput['kind']; label: string; feasible: boolean; infeasibleReasons: string[];
  effectiveHourlyCost: Money; totalCost: Money; contribution: Money; marginPct: number | null; fixedCostExposure: Money;
  riskAdjustedCost: Money; leadTimeWeeks: number; notes: string[];
  hiring?: { totalEmployerCost: Money; productiveHours: number; nonBillableHours: number; rampUpLossHours: number; breakEvenUtilizationPct: number | null; breakEvenHoursVsFreelance: number | null };
}
export interface SourcingResult { demandHours: number; billRate: Money; options: SourcingOptionResult[]; recommendation: { label: string | null; basis: string[]; assumptions: string[]; risks: string[]; alternatives: string[] } }

export type AttractivenessDimension =
  | 'historicalMargin' | 'forecastMargin' | 'cash' | 'capacityEfficiency' | 'demand' | 'winRate' | 'repeatability' | 'scalability'
  | 'crossSelling' | 'strategicImportance' | 'referenceValue' | 'commercialRisk' | 'technicalRisk';
export interface ServiceAttractiveness {
  serviceId: string; code: string; name: string; total: number | null; confidence: number; sampleCount: number;
  dimensions: { key: AttractivenessDimension; score: number | null; raw: number | null; basis: 'OBSERVED' | 'FORECAST' | 'ASSESSMENT' | 'MISSING'; weight: number }[];
  suggestedAction: 'INVEST' | 'PROMOTE' | 'MAINTAIN' | 'REPRICE' | 'STANDARDIZE' | 'AUTOMATE' | 'PARTNER' | 'REDUCE_EXPOSURE' | 'RETIRE' | 'INSUFFICIENT_DATA';
  rationale: string[];
}

export interface BenchmarkStats { n: number; mean: number | null; median: number | null; p10: number | null; p25: number | null; p75: number | null; p90: number | null; stdev: number | null; cv: number | null; outliers: number[] }
export interface ServiceBenchmark {
  serviceId: string; code: string; name: string; sampleCount: number; sufficient: boolean;
  effortRatio: BenchmarkStats; costRatio: BenchmarkStats; durationRatio: BenchmarkStats; marginDeltaPts: BenchmarkStats; actualHours: BenchmarkStats;
  confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
}
