import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class CreateGuaranteeDto {
  @IsString() guaranteeNumber!: string;
  @IsIn(['ADVANCE_PAYMENT', 'PERFORMANCE', 'WARRANTY', 'BID_BOND']) type!: string;
  @IsString() issuingBank!: string;
  @IsNumberString() amount!: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsDateString() issuedDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

class CreateInsuranceDto {
  @IsString() policyNumber!: string;
  @IsIn(['PROFESSIONAL_LIABILITY', 'PUBLIC_LIABILITY', 'D_AND_O', 'CYBER', 'PROPERTY', 'VEHICLE'])
  type!: string;
  @IsString() insurer!: string;
  @IsOptional() @IsNumberString() coverageAmount?: string;
  @IsOptional() @IsNumberString() annualPremium?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class GuaranteesController {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------- bank guarantees

  @Get('guarantees')
  @RequirePermission('contracts.guarantees.read')
  guarantees(@CompanyId() companyId: string) {
    return this.prisma.bankGuarantee.findMany({
      where: {
        deletedAt: null,
        OR: [{ contract: { companyId } }, { contractId: null }],
      },
      include: {
        contract: {
          select: { id: true, contractNumber: true, title: true },
        },
      },
      orderBy: { expiryDate: 'asc' },
    });
  }

  @Post('guarantees')
  @RequirePermission('contracts.guarantees.create')
  createGuarantee(@Body() dto: CreateGuaranteeDto) {
    return this.prisma.bankGuarantee.create({
      data: {
        guaranteeNumber: dto.guaranteeNumber,
        type: dto.type,
        issuingBank: dto.issuingBank,
        amount: dto.amount,
        contractId: dto.contractId,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
  }

  @Patch('guarantees/:id/status')
  @RequirePermission('contracts.guarantees.update')
  updateGuarantee(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'RETURNED' | 'DRAWN' | 'EXPIRED' },
  ) {
    if (!['ACTIVE', 'RETURNED', 'DRAWN', 'EXPIRED'].includes(body.status)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Invalid guarantee status',
      });
    }
    return this.prisma.bankGuarantee.update({
      where: { id },
      data: { status: body.status },
    });
  }

  // ---------------------------------------------------------------- insurance

  @Get('insurance')
  @RequirePermission('contracts.insurance.read')
  insurance() {
    return this.prisma.insurancePolicy.findMany({
      where: { deletedAt: null },
      orderBy: { endDate: 'asc' },
    });
  }

  @Post('insurance')
  @RequirePermission('contracts.insurance.create')
  createInsurance(@Body() dto: CreateInsuranceDto) {
    return this.prisma.insurancePolicy.create({
      data: {
        policyNumber: dto.policyNumber,
        type: dto.type,
        insurer: dto.insurer,
        coverageAmount: dto.coverageAmount,
        annualPremium: dto.annualPremium,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }
}
