import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { EmploymentStatus, Prisma } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  CompanyId,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';
import { OrgChartService } from './org-chart.service';

class ListEmployeesQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: EmploymentStatus })
  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  officeId?: string;
}

class UpsertEmployeeDto {
  @IsString() employeeNumber!: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() salutation?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() workEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() officeId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() discipline?: string;
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsEnum(EmploymentStatus) status?: EmploymentStatus;
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/employees')
export class EmployeesController {
  constructor(private readonly prisma: PrismaService, private readonly chart: OrgChartService) {}

  @Get()
  @RequirePermission('hr.employees.read')
  async list(
    @CompanyId() companyId: string,
    @Query() query: ListEmployeesQuery,
  ) {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.q
        ? {
            OR: [
              { lastName: { contains: query.q, mode: 'insensitive' } },
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { employeeNumber: { contains: query.q, mode: 'insensitive' } },
              { discipline: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          office: { select: { id: true, name: true, city: true } },
          position: { select: { id: true, name: true, level: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Get('org-chart')
  @RequirePermission('hr.employees.read')
  async orgChart(@CompanyId() companyId: string) {
    return this.prisma.employee.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        managerId: true,
        photoUrl: true,
        position: { select: { id: true, code: true, name: true, level: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  @Get('org-chart/positions')
  @RequirePermission('hr.employees.read')
  async orgChartPositions(@CompanyId() companyId: string) {
    return this.chart.positions(companyId);
  }

  @Get(':id')
  @RequirePermission('hr.employees.read')
  async get(@CompanyId() companyId: string, @Param('id') id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        department: true,
        office: true,
        position: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
        skills: { include: { skill: true } },
        certificates: { orderBy: { expiryDate: 'asc' } },
        leaveBalances: { orderBy: { year: 'desc' }, take: 2 },
        assetAssignments: {
          where: { returnedAt: null },
          include: { asset: { select: { id: true, assetNumber: true, name: true } } },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  @Post()
  @RequirePermission('hr.employees.create')
  create(@CompanyId() companyId: string, @Body() dto: UpsertEmployeeDto) {
    return this.prisma.employee.create({
      data: {
        ...dto,
        companyId,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
    });
  }

  @Patch(':id')
  @RequirePermission('hr.employees.update')
  update(@Param('id') id: string, @Body() dto: UpsertEmployeeDto) {
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
    });
  }
}
