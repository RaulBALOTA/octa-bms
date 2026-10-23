import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { BankTransactionQueryDto, CompleteConsentDto, CreateApiKeyConnectionDto, InstitutionsQueryDto, StartConsentDto } from './banking.dto';
import { BankingService } from './banking.service';

/**
 * Read-only bank API connections. "create/update/delete" permissions govern
 * managing a connection inside OCTA; no endpoint can move money at the bank.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/banking')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Get('capabilities') @RequirePermission('finance.banking.read')
  capabilities() { return this.banking.capabilities(); }

  @Get('connections') @RequirePermission('finance.banking.read')
  connections(@CompanyId() company: string) { return this.banking.listConnections(company); }

  @Get('institutions') @RequirePermission('finance.banking.create')
  institutions(@Query() q: InstitutionsQueryDto) { return this.banking.institutions(q.provider, q.country); }

  @Post('connections') @RequirePermission('finance.banking.create')
  create(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyConnectionDto) {
    return this.banking.createApiKeyConnection(company, user, dto);
  }

  @Post('consents') @RequirePermission('finance.banking.create')
  startConsent(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Body() dto: StartConsentDto) {
    return this.banking.startConsent(company, user, dto);
  }

  @Post('consents/complete') @RequirePermission('finance.banking.create')
  completeConsent(@CompanyId() company: string, @Body() dto: CompleteConsentDto) {
    return this.banking.completeConsent(company, dto);
  }

  @Post('connections/:id/sync') @RequirePermission('finance.banking.update')
  sync(@CompanyId() company: string, @Param('id') id: string) { return this.banking.sync(company, id); }

  @Delete('connections/:id') @RequirePermission('finance.banking.delete')
  disconnect(@CompanyId() company: string, @Param('id') id: string) { return this.banking.disconnect(company, id); }

  @Get('transactions') @RequirePermission('finance.banking.read')
  transactions(@CompanyId() company: string, @Query() q: BankTransactionQueryDto) { return this.banking.listTransactions(company, q); }
}
