import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceDirection, InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { VALID_PLAN_CATEGORIES } from './budget-structure';

export class ListInvoicesQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: InvoiceDirection })
  @IsOptional()
  @IsEnum(InvoiceDirection)
  direction?: InvoiceDirection;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partnerId?: string;
}

export class InvoiceLineDto {
  @IsString() description!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsString() unit?: string;
  @IsNumberString() unitPrice!: string;
  @IsString() taxCodeId!: string;
  @IsOptional() @IsString() costCenterId?: string;
  /** Kostenart code from the GuV budget structure (finance/budgets/categories) */
  @IsOptional() @IsIn(VALID_PLAN_CATEGORIES) budgetCategory?: string;
}

export class CreateInvoiceDto {
  @IsEnum(InvoiceDirection) direction!: InvoiceDirection;
  @IsString() partnerId!: string;
  @IsDateString() invoiceDate!: string;
  @IsOptional() @IsDateString() serviceDate?: string;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() currencyCode?: string;
  @IsOptional() @IsString() externalNumber?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() contractId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class TransitionInvoiceDto {
  @IsEnum(InvoiceStatus) status!: InvoiceStatus;
}
