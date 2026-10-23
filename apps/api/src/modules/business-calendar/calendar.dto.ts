import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateNested, ValidateIf } from 'class-validator';
import { CalendarDomain, CalendarKind, CalendarSensitivity, CalendarStatus } from '@prisma/client';

export class ChecklistDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsBoolean() done!: boolean;
}
export class GrantDto {
  @IsString() @MinLength(1) @MaxLength(100) userId!: string;
  @IsBoolean() canEdit!: boolean;
}
export class CalendarFieldsDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsEnum(CalendarDomain) domain?: CalendarDomain;
  @ValidateIf((_o, v) => v !== undefined) @IsEnum(CalendarKind) kind?: CalendarKind;
  @ValidateIf((_o, v) => v !== undefined) @IsEnum(CalendarSensitivity) sensitivity?: CalendarSensitivity;
  @IsOptional() @IsString() @MaxLength(100) ownerUserId?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(4) priority?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(100) timezoneIana?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() allDay?: boolean;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOnly?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDateOnly?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) hardDueDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) internalTargetDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) forecastDate?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/) startsAt?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/) endsAt?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/) hardDueAt?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() completionEvidenceRequired?: boolean;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) sourceUrl?: string | null;
  @IsOptional() @IsIn(['contract', 'invoice', 'opportunity', 'partner', 'employee']) businessEntityType?: string | null;
  @IsOptional() @IsString() @MaxLength(100) businessEntityId?: string | null;
  @IsOptional() @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) recurrenceFrequency?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(120) recurrenceInterval?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) recurrenceUntil?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistDto) checklist?: ChecklistDto[];
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GrantDto) grants?: GrantDto[];
}
export class CreateCalendarItemDto extends CalendarFieldsDto {
  @ValidateIf(() => true)
  @IsString() @MinLength(1) @MaxLength(250) declare title: string;
  @ValidateIf(() => true)
  @IsEnum(CalendarDomain) declare domain: CalendarDomain;
  @ValidateIf(() => true)
  @IsEnum(CalendarKind) declare kind: CalendarKind;
}
export class UpdateCalendarItemDto extends CalendarFieldsDto {
  @IsInt() @Min(1) version!: number;
}
export class VersionDto { @IsInt() @Min(1) version!: number; }
export class TransitionDto extends VersionDto {
  @IsEnum(CalendarStatus) status!: CalendarStatus;
}
export class EvidenceDto extends VersionDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) url!: string;
}
export class CalendarQueryDto {
  @IsOptional() @IsString() @MaxLength(250) search?: string;
  @IsOptional() @IsEnum(CalendarDomain) domain?: CalendarDomain;
  @IsOptional() @IsEnum(CalendarStatus) status?: CalendarStatus;
  @IsOptional() @IsString() @MaxLength(100) owner?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize = 100;
}
export class CalendarEntityQueryDto {
  @IsIn(['contract', 'invoice', 'opportunity', 'partner', 'employee']) type!: string;
  @IsOptional() @IsString() @MaxLength(250) search?: string;
  @IsOptional() @IsString() @MaxLength(100) selectedId?: string;
}
