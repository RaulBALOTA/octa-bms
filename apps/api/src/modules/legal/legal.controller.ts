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
import { RequirePermission } from '../../core/auth/decorators';
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
  async compliance(@Query() query: PageQueryDto) {
    const where: Prisma.ComplianceItemWhereInput = {
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
  createCompliance(@Body() dto: UpsertComplianceDto) {
    return this.prisma.complianceItem.create({
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
    });
  }

  @Patch('compliance-items/:id')
  @RequirePermission('legal.compliance.update')
  updateCompliance(@Param('id') id: string, @Body() dto: UpdateComplianceDto) {
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
  async cases(@Query() query: PageQueryDto) {
    const where: Prisma.LegalCaseWhereInput = {
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
  createCase(@Body() dto: UpsertCaseDto) {
    return this.prisma.legalCase.create({
      data: { ...dto, openedDate: new Date() },
    });
  }

  @Patch('cases/:id')
  @RequirePermission('legal.cases.update')
  updateCase(@Param('id') id: string, @Body() dto: UpdateCaseDto) {
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
