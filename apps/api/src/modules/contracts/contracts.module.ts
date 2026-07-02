import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [MasterDataModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
