import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreatePartnerDto, ListPartnersQuery, UpdatePartnerDto } from './dto';
import { PartnersService } from './partners.service';

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermission('crm.partners.read')
  list(@CompanyId() companyId: string, @Query() query: ListPartnersQuery) {
    return this.partners.list(companyId, query);
  }

  @Get(':id')
  @RequirePermission('crm.partners.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.partners.get(companyId, id);
  }

  @Post()
  @RequirePermission('crm.partners.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePartnerDto,
  ) {
    return this.partners.create(companyId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('crm.partners.update')
  update(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.partners.update(companyId, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission('crm.partners.delete')
  @HttpCode(204)
  remove(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.partners.remove(companyId, id);
  }
}
