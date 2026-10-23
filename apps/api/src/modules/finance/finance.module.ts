import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { BudgetsController } from './budgets.controller';
import { DatevController } from './datev.controller';
import { DunningController } from './dunning.controller';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsController } from './payments.controller';
import { TreasuryController } from './treasury.controller';

@Module({
  imports: [MasterDataModule],
  controllers: [
    BudgetsController,
    DunningController,
    InvoicesController,
    PaymentsController,
    TreasuryController,
    DatevController,
  ],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class FinanceModule {}
