import { ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ListAssetsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: AssetStatus })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;
}

export class CreateAssetDto {
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsNumberString() purchasePrice?: string;
  @IsOptional() @IsDateString() warrantyUntil?: string;
  @IsOptional() @IsString() licensePlate?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}

export class AssignAssetDto {
  @IsString() employeeId!: string;
}
