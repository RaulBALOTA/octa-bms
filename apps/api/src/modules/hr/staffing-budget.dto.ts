import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { StaffingBudgetInput, StaffingBudgetLineInput } from '../../../../../packages/shared/src/staffing-budget';

const money = /^\d{1,8}(\.\d{1,2})?$/;
export class StaffingBudgetLineDto implements StaffingBudgetLineInput {
  @IsString() positionId!: string;
  @IsOptional() @IsString() officeId?: string | null;
  @IsInt() @Min(1) @Max(100) headcount!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1) fte!: number;
  @IsString() @Matches(money) annualSalary!: string;
  @IsOptional() @IsString() @Matches(money) forecastAnnualSalary?: string | null;
  @IsString() @Matches(money) annualBonus!: string;
  @IsString() @Matches(money) monthlyBenefits!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) employerCostPct!: number;
  @IsString() @Matches(money) recruitingCost!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) plannedStart!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) forecastStart!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) endDate?: string | null;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) hiringProbability!: number;
}
export class StaffingBudgetDto implements StaffingBudgetInput {
  @IsString() @Matches(/\S/) @MaxLength(120) title!: string;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsBoolean() includeOpen!: boolean;
  @IsBoolean() includeBudgeted!: boolean;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StaffingBudgetLineDto) lines!: StaffingBudgetLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
