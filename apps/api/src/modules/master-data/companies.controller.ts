import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { CreateCompanyDto, CreateOfficeDto, UpdateCompanyDto, UpdateOfficeDto } from './organization.dto';
import { OrganizationService } from './organization.service';

@ApiTags('master-data')
@ApiBearerAuth()
@Controller('master/companies')
export class CompaniesController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission('admin.masterdata.read')
  list(@CurrentUser() user: AuthUser) { return this.organization.list(user); }

  @Get(':id')
  @RequirePermission('admin.masterdata.read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.organization.get(user, id); }

  @Post()
  @RequirePermission('admin.masterdata.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) { return this.organization.create(user, dto); }

  @Patch(':id')
  @RequirePermission('admin.masterdata.update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.organization.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermission('admin.masterdata.delete')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.organization.remove(user, id); }

  @Get(':companyId/offices/:id')
  @RequirePermission('admin.masterdata.read')
  getOffice(@CurrentUser() user: AuthUser, @Param('companyId') companyId: string, @Param('id') id: string) {
    return this.organization.getOffice(user, companyId, id);
  }

  @Post(':companyId/offices')
  @RequirePermission('admin.masterdata.create')
  createOffice(@CurrentUser() user: AuthUser, @Param('companyId') companyId: string, @Body() dto: CreateOfficeDto) {
    return this.organization.createOffice(user, companyId, dto);
  }

  @Patch(':companyId/offices/:id')
  @RequirePermission('admin.masterdata.update')
  updateOffice(@CurrentUser() user: AuthUser, @Param('companyId') companyId: string, @Param('id') id: string, @Body() dto: UpdateOfficeDto) {
    return this.organization.updateOffice(user, companyId, id, dto);
  }

  @Delete(':companyId/offices/:id')
  @RequirePermission('admin.masterdata.delete')
  @HttpCode(204)
  removeOffice(@CurrentUser() user: AuthUser, @Param('companyId') companyId: string, @Param('id') id: string) {
    return this.organization.removeOffice(user, companyId, id);
  }
}
