import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerStatus, PartnerType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ListPartnersQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: PartnerType })
  @IsOptional()
  @IsEnum(PartnerType)
  type?: PartnerType;

  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segment?: string;
}

export class CreatePartnerDto {
  @IsEnum(PartnerType) type!: PartnerType;
  @IsString() name!: string;
  @IsOptional() @IsEnum(PartnerStatus) status?: PartnerStatus;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() legalForm?: string;
  @IsOptional() @IsString() vatId?: string;
  @IsOptional() @IsString() industryCode?: string;
  @IsOptional() @IsString() segment?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsInt() paymentTermDays?: number;
  @IsOptional() @IsString() accountManagerId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdatePartnerDto extends CreatePartnerDto {
  @IsOptional() @IsEnum(PartnerType) declare type: PartnerType;
  @IsOptional() @IsString() declare name: string;
}
