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
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { ContractsService } from './contracts.service';
import {
  CreateContractDto,
  ListContractsQuery,
  TransitionContractDto,
  UpdateContractDto,
} from './dto';

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermission('contracts.contracts.read')
  list(@CompanyId() companyId: string, @Query() query: ListContractsQuery) {
    return this.contracts.list(companyId, query);
  }

  @Get('expiring')
  @RequirePermission('contracts.contracts.read')
  expiring(
    @CompanyId() companyId: string,
    @Query('withinDays') withinDays = '90',
  ) {
    return this.contracts.expiring(companyId, Number(withinDays));
  }

  @Get(':id')
  @RequirePermission('contracts.contracts.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.contracts.get(companyId, id);
  }

  @Post()
  @RequirePermission('contracts.contracts.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContractDto,
  ) {
    return this.contracts.create(companyId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('contracts.contracts.update')
  update(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(companyId, user.id, id, dto);
  }

  @Post(':id/renew')
  @RequirePermission('contracts.contracts.update')
  renew(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { startDate: string; endDate?: string },
  ) {
    return this.contracts.renew(companyId, user.id, id, body.startDate, body.endDate);
  }

  @Post(':id/transition')
  @RequirePermission('contracts.contracts.update')
  transition(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransitionContractDto,
  ) {
    return this.contracts.transition(companyId, user.id, id, dto.status);
  }
}
