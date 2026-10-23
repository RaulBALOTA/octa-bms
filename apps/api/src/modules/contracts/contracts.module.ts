import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { ContractItemsController } from './contract-items.controller';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { GuaranteesController } from './guarantees.controller';

@Module({
  imports: [MasterDataModule, FinanceModule],
  // GuaranteesController first: its literal routes (contracts/guarantees,
  // contracts/insurance) must register before ContractsController's :id route.
  controllers: [GuaranteesController, ContractItemsController, ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
