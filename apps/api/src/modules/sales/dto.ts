import { ApiPropertyOptional } from '@nestjs/swagger';
import { OpportunityStage } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ListOpportunitiesQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: OpportunityStage })
  @IsOptional()
  @IsEnum(OpportunityStage)
  stage?: OpportunityStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partnerId?: string;
}

export class CreateOpportunityDto {
  @IsString() title!: string;
  @IsString() partnerId!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumberString() estimatedValue?: string;
  @IsOptional() @IsString() currencyCode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsDateString() expectedAward?: string;
  @IsOptional() @IsDateString() submissionDeadline?: string;
  @IsOptional() @IsString() sector?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() ownerId?: string;
}

export class UpdateOpportunityDto extends CreateOpportunityDto {
  @IsOptional() @IsString() declare title: string;
  @IsOptional() @IsString() declare partnerId: string;
}

export class TransitionOpportunityDto {
  @IsEnum(OpportunityStage) stage!: OpportunityStage;
  @IsOptional() @IsString() lostReason?: string;
}
