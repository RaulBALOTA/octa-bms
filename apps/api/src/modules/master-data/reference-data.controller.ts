import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

/** Read-only lookups every authenticated user needs for form dropdowns. */
@ApiTags('master-data')
@ApiBearerAuth()
@Controller('master')
export class ReferenceDataController {
  constructor(private readonly prisma: PrismaService) {}

  /** Own company's letterhead data — readable by every authenticated user. */
  @Get('company-profile')
  companyProfile(@CompanyId() companyId: string) {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        legalForm: true,
        vatId: true,
        taxNumber: true,
        commercialRegister: true,
        street: true,
        postalCode: true,
        city: true,
        phone: true,
        email: true,
        website: true,
      },
    });
  }

  @Get('departments')
  departments(@CompanyId() companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, parentId: true, managerId: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('offices')
  offices(@CompanyId() companyId: string) {
    return this.prisma.office.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, city: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('positions')
  positions() {
    return this.prisma.position.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, level: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('countries')
  countries() {
    return this.prisma.country.findMany({ orderBy: { name: 'asc' } });
  }

  @Get('currencies')
  currencies() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  @Get('tax-codes')
  taxCodes() {
    return this.prisma.taxCode.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  @Get('contract-types')
  contractTypes() {
    return this.prisma.contractTypeRef.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('document-types')
  documentTypes() {
    return this.prisma.documentTypeRef.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('asset-categories')
  assetCategories() {
    return this.prisma.assetCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}
