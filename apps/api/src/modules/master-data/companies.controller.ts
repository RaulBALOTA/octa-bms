import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class UpsertCompanyDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() legalForm?: string;
  @IsOptional() @IsString() vatId?: string;
  @IsOptional() @IsString() taxNumber?: string;
  @IsOptional() @IsString() commercialRegister?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
}

@ApiTags('master-data')
@ApiBearerAuth()
@Controller('master/companies')
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('admin.masterdata.read')
  list() {
    return this.prisma.company.findMany({
      where: { deletedAt: null },
      include: {
        offices: { where: { deletedAt: null } },
        _count: { select: { employees: true, departments: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  @Get(':id')
  @RequirePermission('admin.masterdata.read')
  async get(@Param('id') id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: {
        offices: { where: { deletedAt: null } },
        departments: { where: { deletedAt: null } },
        businessUnits: { where: { deletedAt: null } },
        costCenters: { where: { deletedAt: null } },
      },
    });
    if (!company) throw new NotFoundException();
    return company;
  }

  @Post()
  @RequirePermission('admin.masterdata.create')
  create(@Body() dto: UpsertCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  @Patch(':id')
  @RequirePermission('admin.masterdata.update')
  update(@Param('id') id: string, @Body() dto: UpsertCompanyDto) {
    return this.prisma.company.update({ where: { id }, data: dto });
  }
}
