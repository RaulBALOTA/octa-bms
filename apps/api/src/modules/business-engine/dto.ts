import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import type { ScenarioOperation } from '../../../../../packages/shared/src/business-engine';

export const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
export const SIGNED_MONEY = /^-?\d{1,14}(\.\d{1,2})?$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FEE_MODELS = ['FIXED_FEE', 'TIME_AND_MATERIALS', 'DAILY_RATE', 'RETAINER', 'MILESTONE', 'CAPEX_PERCENT', 'HYBRID'] as const;
export const BILLING = ['MONTHLY', 'MILESTONE', 'UPFRONT', 'ON_COMPLETION'] as const;
export const LIFECYCLE = ['PROPOSED', 'EXPERIMENTAL', 'COMMERCIAL', 'GROWING', 'CORE', 'UNDER_REVIEW', 'RETIRED'] as const;
export const DELIVERY = ['INTERNAL', 'FREELANCE', 'SUBCONTRACT', 'PARTNER', 'HYBRID'] as const;
export const RESOURCE_KINDS = ['EMPLOYEE', 'MANAGEMENT', 'PART_TIME', 'FREELANCER', 'CONSULTANT', 'SUBCONTRACTOR', 'PARTNER', 'ENGINEERING_OFFICE', 'AUTOMATION'] as const;
export const INTERNAL_KINDS = new Set(['EMPLOYEE', 'MANAGEMENT', 'PART_TIME', 'AUTOMATION']);
export const SENIORITY = ['JUNIOR', 'PROFESSIONAL', 'SENIOR', 'LEAD', 'PRINCIPAL'] as const;
export const MODES = ['CONTRACTED', 'EXPECTED', 'ALL_WIN'] as const;
export const ASSIGNMENT_STATUS = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export const FORECAST_KINDS = ['ESTIMATE', 'CONTRACT_BASELINE', 'APPROVED_BUDGET', 'FORECAST', 'ACTUAL'] as const;
export const DECISION_STATUS = ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'SUPERSEDED'] as const;
export const ACTION_KINDS = ['REFORECAST', 'REALLOCATE', 'REPRICE', 'RENEGOTIATE', 'SUBCONTRACT', 'RECOVER_INVOICE', 'ESCALATE', 'CHANGE_PLAN'] as const;

/**
 * Free-form JSON (validated by dedicated validators) must bypass implicit type conversion: with
 * emitted decorator metadata, `unknown[]` elements would otherwise be converted to arrays.
 */
const Raw = () => Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);

const score = () => [IsOptional(), IsInt(), Min(1), Max(5)];
function Score(): PropertyDecorator { return (target, key) => score().forEach((d) => d(target, key)); }

/* ---------------------------------------------------------------- settings */
export class SettingsDto {
  @Raw() @IsObject() config!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsBoolean() confirm?: boolean;
  /** 0 = settings never saved (defaults in use). */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

/* ---------------------------------------------------------------- catalog */
export class RequirementDto {
  @IsOptional() @IsString() skillId?: string | null;
  @IsString() @Matches(/\S/) @MaxLength(120) role!: string;
  @IsIn(SENIORITY) seniority!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) typicalHours!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) internalSharePct?: number;
  @IsOptional() @Matches(MONEY) costRate?: string | null;
  @IsOptional() @Matches(MONEY) externalRate?: string | null;
  @IsOptional() @Matches(MONEY) billRate?: string | null;
}
export class ServiceDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,30}$/) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsString() @Matches(/^[A-Z_]{2,40}$/) category!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() ownerEmployeeId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) targetSegments?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) projectTypes?: string[];
  @IsOptional() @IsString() @MaxLength(200) contractModel?: string | null;
  @IsIn(FEE_MODELS) revenueModel!: string;
  @IsIn(DELIVERY) deliveryModel!: string;
  @IsOptional() @IsBoolean() externalDeliveryAllowed?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(520) typicalDurationWeeks?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  @IsOptional() @Matches(MONEY) targetHourlyRate?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100) @Max(100) targetMarginPct?: number | null;
  @IsOptional() @IsIn(['ADVANCE', 'MONTHLY', 'MILESTONE', 'ON_COMPLETION']) workingCapitalProfile?: string | null;
  @Score() commercialRisk?: number | null; @Score() technicalRisk?: number | null; @Score() contractualRisk?: number | null;
  @Score() strategicImportance?: number | null; @Score() repeatability?: number | null; @Score() scalability?: number | null;
  @Score() crossSelling?: number | null; @Score() referenceValue?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RequirementDto) requirements?: RequirementDto[];
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
export class LifecycleDto {
  @IsIn(LIFECYCLE) toState!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class PackageItemDto {
  @IsString() serviceId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100) hoursFactor?: number;
  @IsOptional() @Matches(MONEY) feeOverride?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
export class PackageDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,30}$/) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PackageItemDto) items!: PackageItemDto[];
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
export class SkillDto {
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) nameDe?: string | null;
  @IsIn(['DISCIPLINE', 'SOFTWARE', 'LANGUAGE', 'METHOD', 'SOFT_SKILL']) category!: string;
  @IsOptional() @IsString() parentId?: string | null;
}
export class SkillParentDto { @IsOptional() @IsString() parentId?: string | null; }

/* ---------------------------------------------------------------- resources */
export class ResourceDto {
  @IsIn(RESOURCE_KINDS) kind!: string;
  @IsOptional() @IsIn(['PLANNED', 'ACTIVE', 'INACTIVE']) status?: string;
  @IsOptional() @IsString() employeeId?: string | null;
  @IsOptional() @IsString() partnerId?: string | null;
  @IsString() @Matches(/\S/) @MaxLength(160) displayName!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(168) weeklyHours!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(150) maxAllocationPct?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nonProjectPct?: number;
  @IsOptional() @Matches(DATE) activeFrom?: string | null;
  @IsOptional() @Matches(DATE) activeTo?: string | null;
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @IsBoolean() remoteEligible?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) languages?: string[];
  @IsOptional() @IsString() @MaxLength(2000) restrictions?: string | null;
}
export class RateDto {
  @Matches(DATE) effectiveFrom!: string;
  @Matches(MONEY) costRate!: string;
  @IsOptional() @Matches(MONEY) billRate?: string | null;
  @IsOptional() @Matches(MONEY) monthlyFixedCost?: string | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ResourceSkillDto { @IsString() skillId!: string; @IsInt() @Min(1) @Max(5) level!: number; }
export class ResourceSkillsDto { @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ResourceSkillDto) skills!: ResourceSkillDto[]; }
export class AbsenceDto {
  @Matches(DATE) startDate!: string; @Matches(DATE) endDate!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1) fraction?: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/* ---------------------------------------------------------------- assignments */
export class AssignmentDto {
  @IsString() clientId!: string;
  @IsOptional() @IsString() contractId?: string | null;
  @IsOptional() @IsString() opportunityId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) externalProjectRef?: string | null;
  @IsString() serviceId!: string;
  @IsOptional() @IsString() packageId?: string | null;
  @IsString() @Matches(/\S/) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(8000) scope?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) deliverables?: string | null;
  @IsOptional() @IsString() responsibleEmployeeId?: string | null;
  @Matches(DATE) startDate!: string;
  @Matches(DATE) endDate!: string;
  @IsIn(FEE_MODELS) feeModel!: string;
  @IsOptional() @Matches(MONEY) fixedFee?: string | null;
  @IsOptional() @Matches(MONEY) hourlyRate?: string | null;
  @IsOptional() @Matches(MONEY) dailyRate?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(24) hoursPerDay?: number | null;
  @IsOptional() @Matches(MONEY) monthlyRetainer?: string | null;
  @IsOptional() @Matches(MONEY) capexBasis?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) capexBasisDefinition?: string | null;
  @IsOptional() @Matches(/^\d{1,3}(\.\d{1,3})?$/) capexPercent?: string | null;
  @IsIn(BILLING) billing!: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermDays?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50) vatRatePct?: number | null;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  @IsOptional() @Matches(MONEY) travelCost?: string;
  @IsOptional() @Matches(MONEY) softwareCost?: string;
  @IsOptional() @Matches(MONEY) otherCost?: string;
  @IsOptional() @Matches(MONEY) subcontractFixedCost?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) probabilityOverride?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) probabilityNote?: string | null;
  @IsOptional() @IsString() @MaxLength(80) exclusiveGroup?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(52) shiftableWeeks?: number;
  @IsOptional() @IsString() @MaxLength(4000) risks?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) assumptions?: string | null;
  @ApiPropertyOptional({ enum: ['SERVICE', 'PACKAGE', 'NONE'] }) @IsOptional() @IsIn(['SERVICE', 'PACKAGE', 'NONE']) generateDemand?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
export class AssignmentStatusDto { @IsIn(ASSIGNMENT_STATUS) status!: string; @IsOptional() @IsString() @MaxLength(1000) note?: string; }
export class DemandDto {
  @IsOptional() @IsString() skillId?: string | null;
  @IsString() @Matches(/\S/) @MaxLength(120) role!: string;
  @IsIn(SENIORITY) seniority!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) hours!: number;
  @IsOptional() @Matches(DATE) startDate?: string | null;
  @IsOptional() @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsString() resourceId?: string | null;
  @IsIn(['INTERNAL', 'EXTERNAL']) sourcing!: string;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @Matches(MONEY) costRate?: string | null;
  @IsOptional() @Matches(MONEY) externalRate?: string | null;
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @IsString() @MaxLength(500) overrideNote?: string | null;
}
export class MilestoneDto {
  @IsString() @Matches(/\S/) @MaxLength(200) title!: string; @Matches(DATE) dueDate!: string; @Matches(MONEY) amount!: string;
  @IsOptional() @IsBoolean() isInvoiced?: boolean;
}
export class AdjustmentDto {
  @Matches(DATE) effectiveDate!: string; @Matches(SIGNED_MONEY) amount!: string;
  @IsIn(['SCOPE_CHANGE', 'AMENDMENT', 'VARIATION']) kind!: string; @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class DemandActualDto { @IsString() id!: string; @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) actualHours!: number; @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) remainingHours?: number | null; }
export class ActualsDto {
  @Matches(DATE) actualsAsOf!: string;
  @IsOptional() @Matches(MONEY) actualCost?: string;
  @IsOptional() @Matches(MONEY) actualRevenue?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) percentComplete?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DemandActualDto) demand?: DemandActualDto[];
}
export class ForecastVersionDto { @IsIn(FORECAST_KINDS) kind!: string; @IsOptional() @IsString() @MaxLength(1000) note?: string; }
export class PmoProgressDto {
  @IsString() @MaxLength(120) externalProjectRef!: string;
  @IsString() @MaxLength(30) serviceCode!: string;
  @Matches(DATE) asOf!: string;
  @IsOptional() @IsIn(ASSIGNMENT_STATUS) status?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) percentComplete?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) actualHours?: number;
  @IsOptional() @Matches(MONEY) actualCost?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) remainingHours?: number;
  @IsOptional() @Matches(DATE) startDate?: string;
  @IsOptional() @Matches(DATE) endDate?: string;
}

/* ---------------------------------------------------------------- analytics */
export class PortfolioQuery {
  @IsOptional() @IsIn(MODES) mode?: (typeof MODES)[number];
  @IsOptional() @Matches(DATE) asOf?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() scenarioId?: string;
}
export class SourcingOptionDto {
  @IsIn(['INTERNAL', 'HIRE', 'FREELANCE', 'SUBCONTRACT', 'PARTNER', 'HYBRID']) kind!: 'INTERNAL' | 'HIRE' | 'FREELANCE' | 'SUBCONTRACT' | 'PARTNER' | 'HYBRID';
  @IsString() @MaxLength(120) label!: string;
  @IsOptional() @Matches(MONEY) hourlyCost?: string;
  @IsOptional() @Matches(MONEY) annualSalary?: string;
  @IsOptional() @Matches(MONEY) annualBenefits?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(60) weeklyHours?: number;
  @IsOptional() @Matches(MONEY) fixedInvestment?: string;
  @IsOptional() @IsNumber() @Min(0) capacityHours?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(104) leadTimeWeeks?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) coordinationOverheadPct?: number;
  @IsOptional() @IsNumber() @Min(0) minimumCommitmentHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) riskScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) qualityControlPct?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) strategicScore?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) dependencyRisk?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) internalSharePct?: number;
}
export class SourcingDto {
  @IsNumber() @Min(1) @Max(1_000_000) demandHours!: number;
  @Matches(MONEY) billRate!: string;
  @IsOptional() @IsInt() @Min(0) @Max(104) requiredWithinWeeks?: number | null;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SourcingOptionDto) options!: SourcingOptionDto[];
}

/* ---------------------------------------------------------------- scenarios / optimization */
export class ScenarioDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsIn(MODES) mode!: string;
  @Raw() @IsArray() @ArrayMaxSize(50) operations!: unknown[];
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
export class ScenarioStatusDto { @IsIn(['DRAFT', 'ACTIVE', 'APPROVED', 'ARCHIVED']) status!: string; }
export class RunScenarioDto {
  @IsIn(['DETERMINISTIC', 'MONTE_CARLO', 'SENSITIVITY']) kind!: string;
  @IsOptional() @IsInt() @Min(10) @Max(10000) iterations?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) seed?: number;
  @IsOptional() @IsIn(['PRICE', 'HOURS', 'INTERNAL_RATE', 'EXTERNAL_RATE', 'DURATION', 'PROBABILITY', 'PAYMENT_DELAY']) parameter?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsNumber({}, { each: true }) steps?: number[];
  @IsOptional() @IsBoolean() includeContracted?: boolean;
}
export class CompareDto { @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) scenarioIds!: string[]; @IsOptional() @IsIn(MODES) mode?: string; }
export class OptimizationDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @Raw() @IsObject() objectiveWeights?: Record<string, number>;
  @IsOptional() @IsNumber() @Min(1) @Max(120) timeLimitSeconds?: number;
  @IsOptional() @IsBoolean() allowExternalSourcing?: boolean;
  @IsOptional() @IsBoolean() allowShifts?: boolean;
  @IsOptional() @IsBoolean() cashConstraint?: boolean;
  @IsOptional() @IsIn(['IF_WON', 'EXPECTED']) basis?: 'IF_WON' | 'EXPECTED';
  @IsOptional() @Raw() @IsArray() @ArrayMaxSize(10) hireOptions?: unknown[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) mandatoryOpportunityKeys?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) excludedOpportunityKeys?: string[];
}

/* ---------------------------------------------------------------- intelligence */
export class AlertTransitionDto { @IsIn(['ACKNOWLEDGED', 'RESOLVED']) status!: string; @IsOptional() @IsString() @MaxLength(2000) resolution?: string; }
export class ActionDto {
  @IsIn(ACTION_KINDS) kind!: string; @IsString() @Matches(/\S/) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() alertId?: string | null; @IsOptional() @IsString() @MaxLength(40) entityType?: string | null; @IsOptional() @IsString() entityId?: string | null;
  @IsOptional() @IsString() ownerUserId?: string | null; @IsOptional() @Matches(DATE) dueDate?: string | null;
}
export class ActionUpdateDto { @IsIn(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']) status!: string; @IsOptional() @IsString() @MaxLength(4000) outcome?: string | null; }
export class RecommendationStatusDto { @IsIn(['ACCEPTED', 'DISMISSED']) status!: string; }
export class DecisionDto {
  @IsString() @Matches(/\S/) @MaxLength(200) title!: string; @IsOptional() @IsString() @MaxLength(8000) context?: string | null;
  @IsOptional() @IsString() recommendationId?: string | null; @IsOptional() @IsString() scenarioId?: string | null; @IsOptional() @IsString() optimizationRunId?: string | null;
}
export class DecisionTransitionDto { @IsIn(DECISION_STATUS) status!: string; @IsOptional() @IsString() @MaxLength(4000) note?: string; }
export class DecisionOutcomeDto { @IsString() @Matches(/\S/) @MaxLength(8000) actualOutcome!: string; }
export class RecalibrationDecisionDto { @IsIn(['APPROVED', 'REJECTED']) status!: string; @IsOptional() @IsString() @MaxLength(2000) note?: string; }
export class AdvisorDto {
  @IsOptional() @IsString() @MaxLength(2000) question?: string;
  @IsOptional() @IsIn(['de', 'en']) language?: string;
  @IsOptional() @IsIn(MODES) mode?: string;
}

/* ---------------------------------------------------------------- scenario operation validation */
const fail = (index: number, message: string): never => { throw new BadRequestException(`operations[${index}]: ${message}`); };
const isStr = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const ids = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 500 && v.every((x) => isStr(x)));

/** Strict validation of scenario operations: unknown types, keys or out-of-range values are rejected. */
export function validateOperations(raw: unknown[]): ScenarioOperation[] {
  const allowedKeys: Record<string, string[]> = {
    WIN: ['assignmentIds', 'opportunityId'], LOSE: ['assignmentIds', 'opportunityId'], SHIFT: ['assignmentIds', 'opportunityId', 'days'],
    STRETCH: ['assignmentIds', 'opportunityId', 'pct'], PRICE: ['pct', 'serviceId', 'assignmentIds', 'includeContracted'], EFFORT: ['pct', 'serviceId', 'assignmentIds'],
    HIRE: ['name', 'count', 'skillIds', 'level', 'weeklyHours', 'start', 'monthlyFixedCost', 'costRate', 'rampUpWeeks'],
    FREELANCER: ['name', 'skillIds', 'level', 'weeklyHours', 'start', 'end', 'rate'], REMOVE_RESOURCE: ['resourceId', 'from'],
    OUTSOURCE: ['rate', 'serviceId', 'assignmentIds', 'skillId'], LABOR_COST: ['pct', 'internal', 'external'], OVERHEAD: ['pct'],
    PAYMENT_TERMS: ['days', 'clientId', 'assignmentIds'], PAYMENT_DELAY: ['days', 'clientId', 'assignmentIds'], STOP_SERVICE: ['serviceId', 'from'],
    SCOPE: ['pct', 'assignmentIds'], PROBABILITY: ['probabilityPct', 'assignmentIds', 'opportunityId'], OPENING_CASH: ['amount'],
    NEW_SERVICE: ['name', 'start', 'end', 'fixedFee', 'hours', 'skillId', 'probabilityPct', 'externalRate'],
  };
  return raw.map((value, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(i, 'expected object');
    const op = value as Record<string, unknown>;
    const type = op.type as string;
    if (!Object.hasOwn(allowedKeys, type)) fail(i, `unsupported type ${String(type)}`);
    for (const key of Object.keys(op)) if (key !== 'type' && !allowedKeys[type].includes(key)) fail(i, `unknown property ${key}`);
    if (!ids(op.assignmentIds) || !ids(op.skillIds)) fail(i, 'invalid id list');
    for (const key of ['opportunityId', 'serviceId', 'clientId', 'skillId', 'resourceId', 'name', 'title']) if (op[key] !== undefined && !isStr(op[key])) fail(i, `invalid ${key}`);
    for (const key of ['start', 'end', 'from']) if (op[key] !== undefined && op[key] !== null && !(typeof op[key] === 'string' && DATE.test(op[key] as string))) fail(i, `invalid ${key}`);
    for (const key of ['monthlyFixedCost', 'costRate', 'rate']) if (op[key] !== undefined && !(typeof op[key] === 'string' && MONEY.test(op[key] as string))) fail(i, `invalid ${key}`);
    if (op.amount !== undefined && !(typeof op.amount === 'string' && SIGNED_MONEY.test(op.amount))) fail(i, 'invalid amount');
    if (op.pct !== undefined && !isNum(op.pct, -100, 1000)) fail(i, 'pct must be between -100 and 1000');
    if (op.days !== undefined && !isNum(op.days, -730, 730)) fail(i, 'days must be between -730 and 730');
    if (op.probabilityPct !== undefined && !isNum(op.probabilityPct, 0, 100)) fail(i, 'probabilityPct must be 0..100');
    if (op.weeklyHours !== undefined && !isNum(op.weeklyHours, 1, 60)) fail(i, 'weeklyHours must be 1..60');
    if (op.count !== undefined && !(Number.isInteger(op.count) && isNum(op.count, 1, 20))) fail(i, 'count must be 1..20');
    if (op.level !== undefined && !(Number.isInteger(op.level) && isNum(op.level, 1, 5))) fail(i, 'level must be 1..5');
    if (op.rampUpWeeks !== undefined && !isNum(op.rampUpWeeks, 0, 104)) fail(i, 'rampUpWeeks must be 0..104');
    for (const key of ['includeContracted', 'internal', 'external']) if (op[key] !== undefined && typeof op[key] !== 'boolean') fail(i, `invalid ${key}`);
    const need = (keys: string[]) => keys.forEach((k) => { if (op[k] === undefined) fail(i, `${k} is required`); });
    const target = () => { if (!(op.assignmentIds as string[] | undefined)?.length && !op.opportunityId) fail(i, 'assignmentIds or opportunityId is required'); };
    switch (type) {
      case 'WIN': case 'LOSE': case 'PROBABILITY': target(); if (type === 'PROBABILITY') need(['probabilityPct']); break;
      case 'SHIFT': target(); need(['days']); break;
      case 'STRETCH': target(); need(['pct']); break;
      case 'PRICE': case 'EFFORT': case 'LABOR_COST': case 'OVERHEAD': need(['pct']); break;
      case 'SCOPE': need(['pct', 'assignmentIds']); break;
      case 'HIRE': need(['name', 'skillIds', 'weeklyHours', 'start', 'monthlyFixedCost', 'costRate']); break;
      case 'FREELANCER': need(['name', 'skillIds', 'weeklyHours', 'start', 'rate']); break;
      case 'REMOVE_RESOURCE': need(['resourceId', 'from']); break;
      case 'OUTSOURCE': need(['rate']); break;
      case 'PAYMENT_TERMS': case 'PAYMENT_DELAY': need(['days']); if ((op.days as number) < 0 && type === 'PAYMENT_TERMS') fail(i, 'days must be ≥ 0'); break;
      case 'STOP_SERVICE': need(['serviceId']); break;
      case 'OPENING_CASH': need(['amount']); break;
      case 'NEW_SERVICE': {
        need(['name', 'start', 'end', 'fixedFee', 'hours']);
        if (!(typeof op.fixedFee === 'string' && MONEY.test(op.fixedFee))) fail(i, 'invalid fixedFee');
        if (op.externalRate !== undefined && !(typeof op.externalRate === 'string' && MONEY.test(op.externalRate))) fail(i, 'invalid externalRate');
        if (!isNum(op.hours, 0, 100000)) fail(i, 'hours must be 0..100000');
        if ((op.start as string) > (op.end as string)) fail(i, 'end must not precede start');
        const probability = op.probabilityPct === undefined ? 1 : (op.probabilityPct as number) / 100;
        return { type: 'NEW_SERVICE', assignment: {
          title: op.name as string, serviceId: 'sim-new-service', serviceName: op.name as string, serviceCode: 'NEW', packageId: null, clientId: 'sim-client', clientName: 'Simulated client',
          contractId: null, opportunityId: null, externalProjectRef: null, commitment: probability >= 1 ? 'CONTRACTED' : 'PIPELINE', probability, exclusiveGroup: null, shiftableWeeks: 0,
          start: op.start as string, end: op.end as string, feeModel: 'FIXED_FEE', billing: 'MONTHLY', currency: 'EUR', fixedFee: op.fixedFee as string, hourlyRate: null, dailyRate: null,
          hoursPerDay: null, monthlyRetainer: null, capexBasis: null, capexPercent: null, paymentTermDays: 30, vatRatePct: 19,
          expenses: { travel: '0', software: '0', other: '0', subcontractFixed: '0' }, milestones: [], adjustments: [],
          demand: [{ id: 'sim-new-service-demand', skillId: (op.skillId as string) ?? null, skillName: null, role: op.name as string, seniority: 'PROFESSIONAL', hours: op.hours as number,
            start: null, end: null, resourceId: null, sourcing: op.externalRate ? 'EXTERNAL' : 'INTERNAL', billable: true, costRate: null, externalRate: (op.externalRate as string) ?? null, actualHours: 0, remainingHours: null }],
          actuals: { hours: 0, cost: '0', revenue: '0', invoicedNet: '0', percentComplete: null }, baseline: null, targetMarginPct: null, externalDeliveryAllowed: true,
          responsibleUserId: null, strategicScore: null, riskScore: null,
        } } as ScenarioOperation;
      }
    }
    return op as unknown as ScenarioOperation;
  });
}
