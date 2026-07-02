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
import {
  CreateOpportunityDto,
  ListOpportunitiesQuery,
  TransitionOpportunityDto,
  UpdateOpportunityDto,
} from './dto';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @RequirePermission('sales.opportunities.read')
  list(
    @CompanyId() companyId: string,
    @Query() query: ListOpportunitiesQuery,
  ) {
    return this.opportunities.list(companyId, query);
  }

  @Get('pipeline')
  @RequirePermission('sales.opportunities.read')
  pipeline(@CompanyId() companyId: string) {
    return this.opportunities.pipeline(companyId);
  }

  @Get(':id')
  @RequirePermission('sales.opportunities.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.opportunities.get(companyId, id);
  }

  @Post()
  @RequirePermission('sales.opportunities.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.opportunities.create(companyId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('sales.opportunities.update')
  update(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(companyId, user.id, id, dto);
  }

  @Post(':id/transition')
  @RequirePermission('sales.opportunities.update')
  transition(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransitionOpportunityDto,
  ) {
    return this.opportunities.transition(
      companyId,
      user.id,
      id,
      dto.stage,
      dto.lostReason,
    );
  }
}
