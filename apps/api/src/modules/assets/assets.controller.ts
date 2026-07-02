import {
  Body,
  Controller,
  Get,
  Param,
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
import { AssetsService } from './assets.service';
import { AssignAssetDto, CreateAssetDto, ListAssetsQuery } from './dto';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermission('assets.assets.read')
  list(@CompanyId() companyId: string, @Query() query: ListAssetsQuery) {
    return this.assets.list(companyId, query);
  }

  @Get(':id')
  @RequirePermission('assets.assets.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.assets.get(companyId, id);
  }

  @Post()
  @RequirePermission('assets.assets.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAssetDto,
  ) {
    return this.assets.create(companyId, user.id, dto);
  }

  @Post(':id/assign')
  @RequirePermission('assets.assets.update')
  assign(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: AssignAssetDto,
  ) {
    return this.assets.assign(companyId, id, dto.employeeId);
  }

  @Post(':id/return')
  @RequirePermission('assets.assets.update')
  return(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.assets.return(companyId, id);
  }
}
