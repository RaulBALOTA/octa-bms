import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContractStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ListContractsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partnerId?: string;
}

export class CreateContractDto {
  @IsString() title!: string;
  @IsString() contractTypeId!: string;
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumberString() value?: string;
  @IsOptional() @IsString() currencyCode?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsInt() noticePeriodDays?: number;
  @IsOptional() @IsBoolean() autoRenewal?: boolean;
  @IsOptional() @IsInt() renewalMonths?: number;
  @IsOptional() @IsString() riskLevel?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() parentId?: string;
}

export class UpdateContractDto extends CreateContractDto {
  @IsOptional() @IsString() declare title: string;
  @IsOptional() @IsString() declare contractTypeId: string;
  @IsOptional() @IsDateString() signedDate?: string;
}

export class TransitionContractDto {
  @IsEnum(ContractStatus) status!: ContractStatus;
}
