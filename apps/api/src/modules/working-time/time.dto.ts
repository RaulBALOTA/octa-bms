import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TimeRecordKind } from '@prisma/client';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MSG = 'must be a calendar day (YYYY-MM-DD)';
const TIME_MSG = 'must be a time (HH:mm)';

export class EmployeeScopeDto {
  @ApiPropertyOptional({ description: 'Defaults to the employee linked to the caller' })
  @IsOptional() @IsString() employeeId?: string;
}

export class WeekQueryDto extends EmployeeScopeDto {
  @ApiPropertyOptional({ description: 'Any day of the week; defaults to today' })
  @IsOptional() @Matches(DAY, { message: `week ${DAY_MSG}` }) week?: string;
}

export class RangeQueryDto extends EmployeeScopeDto {
  @ApiProperty() @Matches(DAY, { message: `from ${DAY_MSG}` }) from!: string;
  @ApiProperty() @Matches(DAY, { message: `to ${DAY_MSG}` }) to!: string;
}

export class BalanceQueryDto extends EmployeeScopeDto {
  @ApiPropertyOptional({ description: 'Defaults to 1 January of the current year' })
  @IsOptional() @Matches(DAY, { message: `from ${DAY_MSG}` }) from?: string;
  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional() @Matches(DAY, { message: `to ${DAY_MSG}` }) to?: string;
}

export class TimeRecordDto extends EmployeeScopeDto {
  @ApiProperty() @Matches(DAY, { message: `date ${DAY_MSG}` }) date!: string;
  @ApiProperty({ example: '08:00' }) @Matches(TIME, { message: `startTime ${TIME_MSG}` }) startTime!: string;
  @ApiPropertyOptional({ example: '16:30', description: 'Earlier than start → ends next day; omit for an open record' })
  @IsOptional() @Matches(TIME, { message: `endTime ${TIME_MSG}` }) endTime?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(600) breakMinutes?: number;
  @ApiPropertyOptional({ enum: TimeRecordKind }) @IsOptional() @IsEnum(TimeRecordKind) kind?: TimeRecordKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ClockInDto extends EmployeeScopeDto {
  @ApiPropertyOptional({ enum: TimeRecordKind }) @IsOptional() @IsEnum(TimeRecordKind) kind?: TimeRecordKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ClockOutDto extends EmployeeScopeDto {
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(600) breakMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ProjectEntryDto extends EmployeeScopeDto {
  @ApiProperty() @Matches(DAY, { message: `date ${DAY_MSG}` }) date!: string;
  @ApiProperty({ example: 'P-2026-014' }) @IsString() @MaxLength(80) @Matches(/\S/, { message: 'projectCode must not be empty' }) projectCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) projectName?: string;
  @ApiPropertyOptional({ description: 'Task, deliverable or WBS reference' }) @IsOptional() @IsString() @MaxLength(200) taskRef?: string;
  @ApiProperty({ example: 2.5 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(24) hours!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() billable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class DecideTimesheetDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class TimesheetListQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] })
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']) status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @Matches(DAY, { message: `week ${DAY_MSG}` }) week?: string;
}

export class TeamQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DAY, { message: `week ${DAY_MSG}` }) week?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() departmentId?: string;
}

export class WorkScheduleDto {
  @ApiProperty({ example: 'VZ40' }) @IsString() @MaxLength(20) @Matches(/^[A-Za-z0-9_-]+$/, { message: 'code may contain letters, digits, - and _' }) code!: string;
  @ApiProperty({ example: 'Full time 40 h' }) @IsString() @MaxLength(120) @Matches(/\S/, { message: 'name must not be empty' }) name!: string;
  @ApiProperty({ example: [480, 480, 480, 480, 480, 0, 0], description: 'Target minutes Monday..Sunday' })
  @IsArray() @ArrayMinSize(7) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(600, { each: true }) dailyMinutes!: number[];
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(TIME, { message: `coreStart ${TIME_MSG}` }) coreStart?: string;
  @ApiPropertyOptional({ example: '15:00' }) @IsOptional() @Matches(TIME, { message: `coreEnd ${TIME_MSG}` }) coreEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignScheduleDto {
  @ApiProperty() @IsString() employeeId!: string;
  @ApiProperty() @IsString() scheduleId!: string;
  @ApiProperty() @Matches(DAY, { message: `validFrom ${DAY_MSG}` }) validFrom!: string;
}

export class AllocationDto {
  @ApiProperty() @IsString() employeeId!: string;
  @ApiProperty() @IsString() @MaxLength(80) @Matches(/\S/, { message: 'projectCode must not be empty' }) projectCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) projectName?: string;
  @ApiProperty({ description: 'First week (any day in it)' }) @Matches(DAY, { message: `fromWeek ${DAY_MSG}` }) fromWeek!: string;
  @ApiProperty({ description: 'Last week (any day in it)' }) @Matches(DAY, { message: `toWeek ${DAY_MSG}` }) toWeek!: string;
  @ApiProperty({ description: '0 removes the allocation for those weeks' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(80) hoursPerWeek!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CapacityQueryDto {
  @ApiPropertyOptional({ description: 'First week (any day in it); defaults to this week' })
  @IsOptional() @Matches(DAY, { message: `from ${DAY_MSG}` }) from?: string;
  @ApiPropertyOptional({ default: 8 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(26) weeks?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectCode?: string;
}

export class PmoPushEntryDto {
  @ApiProperty({ description: 'PMO TimeEntry id' }) @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsEmail() userEmail!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) resourceName?: string;
  @ApiProperty() @Matches(DAY, { message: `date ${DAY_MSG}` }) date!: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(24) hours!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) projectCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) projectName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) taskTitle?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() billable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class PmoPushDto {
  @ApiProperty({ type: [PmoPushEntryDto] })
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => PmoPushEntryDto) entries!: PmoPushEntryDto[];
  @ApiPropertyOptional({ description: 'PMO TimeEntry ids deleted in PMO' })
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsString({ each: true }) deletedIds?: string[];
}
