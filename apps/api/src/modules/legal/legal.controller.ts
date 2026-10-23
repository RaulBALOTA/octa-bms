import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { assertReferenceInCompany, inCompany, requireInCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';

class UpsertComplianceDto {
  @IsIn(['GDPR', 'ISO_9001', 'ISO_14001', 'ISO_45001', 'LICENSE', 'REGISTER', 'TAX', 'OTHER'])
  category!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsIn(['YEARLY', 'QUARTERLY', 'MONTHLY']) recurrence?: string;
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE'])
  status?: string;
  @IsOptional() @IsString() evidence?: string;
}

class UpdateComplianceDto extends UpsertComplianceDto {
  @IsOptional() @IsString() declare category: string;
  @IsOptional() @IsString() declare title: string;
}

class UpsertCaseDto {
  @IsString() caseNumber!: string;
  @IsString() title!: string;
  @IsIn(['LITIGATION', 'ARBITRATION', 'ADMINISTRATIVE', 'EMPLOYMENT', 'IP'])
  type!: string;
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() externalCounsel?: string;
  @IsOptional() @IsNumberString() amountInDispute?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @IsIn(['OPEN', 'ACTIVE', 'SETTLED', 'CLOSED', 'WON', 'LOST'])
  status?: string;
}

class UpdateCaseDto extends UpsertCaseDto {
  @IsOptional() @IsString() declare caseNumber: string;
  @IsOptional() @IsString() declare title: string;
  @IsOptional() @IsString() declare type: string;
}

@ApiTags('legal')
@ApiBearerAuth()
@Controller('legal')
export class LegalController {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------- compliance register

  @Get('compliance-items')
  @RequirePermission('legal.compliance.read')
  async compliance(@CompanyId() companyId: string, @Query() query: PageQueryDto) {
    const where: Prisma.ComplianceItemWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { category: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.complianceItem.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ dueDate: 'asc' }],
      }),
      this.prisma.complianceItem.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Post('compliance-items')
  @RequirePermission('legal.compliance.create')
  createCompliance(@CompanyId() companyId: string, @Body() dto: UpsertComplianceDto) {
    return this.prisma.complianceItem.create({
      data: { ...dto, companyId, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
    });
  }

  @Patch('compliance-items/:id')
  @RequirePermission('legal.compliance.update')
  async updateCompliance(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateComplianceDto,
  ) {
    await requireInCompany(
      this.prisma.complianceItem.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } }),
      'Compliance item',
    );
    return this.prisma.complianceItem.update({
      where: { id },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        lastReviewDate: new Date(),
      },
    });
  }

  // ------------------------------------------------------------ legal cases

  @Get('cases')
  @RequirePermission('legal.cases.read')
  async cases(@CompanyId() companyId: string, @Query() query: PageQueryDto) {
    const where: Prisma.LegalCaseWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { caseNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.legalCase.findMany({
        where,
        include: { partner: { select: { id: true, name: true } } },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.legalCase.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Post('cases')
  @RequirePermission('legal.cases.create')
  async createCase(@CompanyId() companyId: string, @Body() dto: UpsertCaseDto) {
    await assertReferenceInCompany(dto.partnerId, 'partnerId', inCompany(this.prisma, 'businessPartner', companyId));
    return this.prisma.legalCase.create({
      data: { ...dto, companyId, openedDate: new Date() },
    });
  }

  @Patch('cases/:id')
  @RequirePermission('legal.cases.update')
  async updateCase(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCaseDto,
  ) {
    await requireInCompany(
      this.prisma.legalCase.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } }),
      'Legal case',
    );
    await assertReferenceInCompany(dto.partnerId, 'partnerId', inCompany(this.prisma, 'businessPartner', companyId));
    return this.prisma.legalCase.update({
      where: { id },
      data: {
        ...dto,
        closedDate: ['SETTLED', 'CLOSED', 'WON', 'LOST'].includes(dto.status ?? '')
          ? new Date()
          : undefined,
      },
    });
  }
}
