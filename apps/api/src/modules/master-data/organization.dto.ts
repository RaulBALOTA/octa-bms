import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateCompanyDto {
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(40) code!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(250) name!: string;
  @IsOptional() @IsString() @MaxLength(250) legalName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) legalForm?: string | null;
  @IsOptional() @IsString() @MaxLength(100) vatId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) taxNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(250) commercialRegister?: string | null;
  @IsOptional() @IsString() @MaxLength(500) street?: string | null;
  @IsOptional() @IsString() @MaxLength(30) postalCode?: string | null;
  @IsOptional() @IsString() @MaxLength(250) city?: string | null;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string | null;
  @IsOptional() @IsString() @MaxLength(100) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(250) email?: string | null;
  @IsOptional() @IsUrl() @MaxLength(500) website?: string | null;
  @IsOptional() @IsString() parentCompanyId?: string | null;
  @ValidateIf((o: CreateCompanyDto) => o.defaultCurrency !== undefined) @Matches(/^[A-Z]{3}$/) defaultCurrency?: string;
  @ValidateIf((o: CreateCompanyDto) => o.defaultLocale !== undefined) @IsString() @MinLength(2) @MaxLength(10) defaultLocale?: string;
  @ValidateIf((o: CreateCompanyDto) => o.fiscalYearStart !== undefined) @IsInt() @Min(1) @Max(12) fiscalYearStart?: number;
  @ValidateIf((o: CreateCompanyDto) => o.isActive !== undefined) @IsBoolean() isActive?: boolean;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto, { skipNullProperties: false }) {}

export class CreateOfficeDto {
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(40) code!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(250) name!: string;
  @IsOptional() @IsString() @MaxLength(500) street?: string | null;
  @IsOptional() @IsString() @MaxLength(30) postalCode?: string | null;
  @IsOptional() @IsString() @MaxLength(250) city?: string | null;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string | null;
  @IsOptional() @IsString() @MaxLength(100) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(250) email?: string | null;
  @ValidateIf((o: CreateOfficeDto) => o.isHQ !== undefined) @IsBoolean() isHQ?: boolean;
  @ValidateIf((o: CreateOfficeDto) => o.isActive !== undefined) @IsBoolean() isActive?: boolean;
}

export class UpdateOfficeDto extends PartialType(CreateOfficeDto, { skipNullProperties: false }) {}
