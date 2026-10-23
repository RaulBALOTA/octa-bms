import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class CreateApiKeyConnectionDto {
  @IsIn(['QONTO']) provider!: 'QONTO';
  @IsString() @MaxLength(120) displayName!: string;
  /** Qonto: organization login (slug) shown next to the API key. */
  @IsString() @MaxLength(200) login!: string;
  @IsString() @MaxLength(500) secretKey!: string;
}

export class StartConsentDto {
  @IsIn(['ENABLE_BANKING']) provider!: 'ENABLE_BANKING';
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsString() @MaxLength(200) aspspName!: string;
  @IsString() @Length(2, 2) aspspCountry!: string;
  /** Renew the consent of an existing connection instead of creating one. */
  @IsOptional() @IsString() connectionId?: string;
}

export class CompleteConsentDto {
  @IsString() @MaxLength(200) state!: string;
  @IsString() @MaxLength(2000) code!: string;
}

export class InstitutionsQueryDto {
  @IsIn(['ENABLE_BANKING']) provider!: 'ENABLE_BANKING';
  @IsString() @Length(2, 2) country!: string;
}

export class BankTransactionQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() bankAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['IN', 'OUT'] }) @IsOptional() @IsIn(['IN', 'OUT']) direction?: 'IN' | 'OUT';
}
