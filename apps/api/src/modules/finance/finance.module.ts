import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [MasterDataModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class FinanceModule {}
