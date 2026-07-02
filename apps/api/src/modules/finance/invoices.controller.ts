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
import {
  CreateInvoiceDto,
  ListInvoicesQuery,
  TransitionInvoiceDto,
} from './dto';
import { InvoicesService } from './invoices.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('finance.invoices.read')
  list(@CompanyId() companyId: string, @Query() query: ListInvoicesQuery) {
    return this.invoices.list(companyId, query);
  }

  @Get(':id')
  @RequirePermission('finance.invoices.read')
  get(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.invoices.get(companyId, id);
  }

  @Post()
  @RequirePermission('finance.invoices.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoices.create(companyId, user.id, dto);
  }

  @Post(':id/transition')
  @RequirePermission('finance.invoices.update')
  transition(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransitionInvoiceDto,
  ) {
    return this.invoices.transition(companyId, user.id, id, dto.status);
  }
}
