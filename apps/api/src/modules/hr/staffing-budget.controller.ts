import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { StaffingBudgetDto } from './staffing-budget.dto';
import { StaffingBudgetService } from './staffing-budget.service';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/staffing-budgets')
export class StaffingBudgetController {
  constructor(private readonly budgets: StaffingBudgetService) {}

  @Get('context') @RequirePermission('finance.budgets.read')
  context(@CompanyId() companyId: string) { return this.budgets.context(companyId); }

  @Post('calculate') @RequirePermission('finance.budgets.read')
  calculate(@CompanyId() companyId: string, @Body() dto: StaffingBudgetDto) { return this.budgets.calculate(companyId, dto); }

  @Get() @RequirePermission('finance.budgets.read')
  list(@CompanyId() companyId: string) { return this.budgets.list(companyId); }

  @Get(':id') @RequirePermission('finance.budgets.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) { return this.budgets.get(companyId, id); }

  @Get(':id/revisions/:version') @RequirePermission('finance.budgets.read')
  revision(@CompanyId() companyId: string, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) { return this.budgets.revision(companyId, id, version); }

  @Post() @RequirePermission('finance.budgets.read', 'finance.budgets.create')
  create(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: StaffingBudgetDto) { return this.budgets.save(companyId, user.id, dto); }

  @Put(':id') @RequirePermission('finance.budgets.read', 'finance.budgets.update')
  update(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StaffingBudgetDto) { return this.budgets.save(companyId, user.id, dto, id); }
}
